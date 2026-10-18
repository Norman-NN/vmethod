import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { boardCost, dollars, opencodeUsage, sumUsd, type Price } from "../cost.js";
import type { Config } from "../config.js";
import { modelRecords } from "../learnings.js";
import { object } from "./people.js";
import { workerWorktreePrefix } from "./worker-path.js";

export interface CostBackfillOptions {
  dryRun?: boolean;
  prs?: number[];
}

export interface CostBackfillDependencies {
  root: string;
  config: Config;
  env: NodeJS.ProcessEnv;
  models: { family: string; model: string; price?: Price }[];
  readSession(id: string): Promise<unknown | undefined>;
  inspectCard?(pr: number): Promise<{ cost?: string | null; archived?: boolean }>;
  setCost(pr: number, value: string): Promise<void>;
  listPrs?(): Promise<number[]>;
  report?(message: string): void;
}

/** Recover known per-PR cost from recorded worker sessions without inventing zero usage. */
export async function backfillCosts(
  deps: CostBackfillDependencies,
  options: CostBackfillOptions = {}
): Promise<string> {
  const stateName = String(deps.config.stateName ?? String(deps.config.repo).replace("/", "-"));
  const stateRoot = deps.env.XDG_STATE_HOME ?? join(deps.env.HOME ?? ".", ".local/state");
  const workers = join(stateRoot, "vmethod", stateName, "workers");
  const stateRecords = readWorkerRecords(workers, deps.config.repo);
  const legacyRecords = readLegacyRecords(deps, stateRoot);
  const logPath = join(deps.root, ".vmethod/model-log.jsonl");
  const logRecords = existsSync(logPath) ? modelRecords(readFileSync(logPath, "utf8")) : [];
  const boardPrs = options.prs?.length ? [] : ((await deps.listPrs?.()) ?? []);
  const prs = options.prs?.length
    ? [...new Set(options.prs)]
    : [
        ...new Set([
          ...stateRecords.keys(),
          ...legacyRecords.keys(),
          ...boardPrs,
          ...logRecords
            .filter(
              (record) => record.repo.toLowerCase() === String(deps.config.repo).toLowerCase()
            )
            .map((record) => record.pr),
        ]),
      ].sort((a, b) => a - b);
  const lines: string[] = [];
  let known = 0;
  let total = 0;
  let connectionReported = false;
  for (const pr of prs) {
    const state = stateRecords.get(pr);
    const stateIds = sessionIds(state);
    const legacyId = stateIds.length ? undefined : legacyRecords.get(pr);
    const ids = stateIds.length ? stateIds : legacyId ? [legacyId] : [];
    const logged = logRecords.find(
      (record) =>
        record.repo.toLowerCase() === String(deps.config.repo).toLowerCase() && record.pr === pr
    );
    if (!ids.length && logged?.usd !== undefined && logged.usd !== null) {
      const value = boardCost(logged.usd)!;
      const card = await deps.inspectCard?.(pr);
      const archived =
        card?.archived === true ||
        (!options.dryRun && (await writeCost(deps, pr, value, card?.cost)));
      lines.push(
        `#${pr}: ${archived ? `archived; ${value} recorded in the model log only` : value} (model log)${options.dryRun ? " [dry run]" : ""}`
      );
      known++;
      total += logged.usd;
      continue;
    }
    if (!ids.length) {
      lines.push(`#${pr}: unknown (no recoverable session)`);
      continue;
    }
    const prices: (number | null)[] = [];
    const labels: string[] = [];
    for (const id of ids) {
      if (!id.startsWith("ses_") || object(state?.model).kind === "claude") {
        prices.push(null);
        labels.push(`${id}: Claude session unavailable`);
        continue;
      }
      let response: unknown;
      try {
        response = await deps.readSession(id);
      } catch (error) {
        if (!connectionReported) {
          deps.report?.(
            `OpenCode unavailable; affected sessions are unknown (${(error as Error).message})`
          );
          connectionReported = true;
        }
      }
      if (!response) {
        prices.push(null);
        labels.push(`${id}: session gone`);
        continue;
      }
      const envelope = object(response);
      const session = Object.hasOwn(envelope, "session") ? envelope.session : response;
      const messages = Array.isArray(envelope.messages) ? envelope.messages : [];
      const messageModels = messages
        .filter((message) => object(message).type === "assistant")
        .map((message) => {
          const part = object(message);
          const model = object(part.model);
          const key = `${String(model.providerID ?? "")}/${String(model.id ?? "")}`;
          const family = deps.models.find((item) => item.model === key);
          const usage = opencodeUsage(part);
          return {
            family,
            hasModel: Boolean(model.providerID && model.id),
            usd: family && usage ? dollars(usage.tokens, family.price) : null,
          };
        });
      const hasPerMessageModels = messageModels.some((item) => item.hasModel);
      let usd: number | null;
      let familyLabel: string;
      if (hasPerMessageModels) {
        usd = messageModels.every((item) => item.family && item.usd !== null)
          ? sumUsd(messageModels.map((item) => item.usd))
          : null;
        familyLabel = [
          ...new Set(messageModels.map((item) => item.family?.family).filter(Boolean)),
        ].join("+");
      } else {
        const model = object(object(session).model);
        const key = `${String(model.providerID ?? "")}/${String(model.id ?? "")}`;
        const family = deps.models.find((item) => item.model === key || item.family === key);
        const usage = opencodeUsage(session);
        usd = family && usage ? dollars(usage.tokens, family.price) : null;
        familyLabel = family ? family.family : "";
        const stateSegments = object(state).segments;
        const stateFamilies = Array.isArray(stateSegments)
          ? stateSegments.map((segment: unknown) => object(segment).family).filter(Boolean)
          : [];
        if (new Set(stateFamilies).size > 1) {
          familyLabel = `mixed models, priced at ${family?.family ?? "unknown"}`;
        }
      }
      prices.push(usd);
      labels.push(`${familyLabel || "unknown model"}, session ${id}`);
    }
    const usd = sumUsd(prices);
    if (usd === null) {
      lines.push(`#${pr}: unknown (${labels.join("; ")})`);
      continue;
    }
    const value = boardCost(usd)!;
    const logRecordNeedsBackfill = logged !== undefined && logged.usd == null;
    const logWritten =
      !options.dryRun &&
      updateLog(logPath, logRecords, deps.config.repo, pr, usd, legacyId ? "partial" : "complete");
    const card = await deps.inspectCard?.(pr);
    const archived =
      card?.archived === true ||
      (!options.dryRun && (await writeCost(deps, pr, value, card?.cost)));
    const coverage = legacyId ? "; partial: latest session only" : "";
    lines.push(
      `#${pr}: ${archived ? (logWritten || (options.dryRun && logRecordNeedsBackfill) ? `archived; ${value} recorded in the model log only` : `archived; Cost not updated${logged?.usd == null ? " (no model-log record to backfill)" : `; model log retains ${boardCost(logged.usd)}`}`) : value} (${labels.join(", ")}${coverage})${options.dryRun ? " [dry run]" : ""}`
    );
    known++;
    total += usd;
  }
  lines.push(`Total: ${known} priced PR(s), ${boardCost(total)}; ${prs.length - known} unknown`);
  return lines.join("\n");
}

function readWorkerRecords(directory: string, repo: unknown): Map<number, Record<string, unknown>> {
  const records = new Map<number, Record<string, unknown>>();
  if (!existsSync(directory)) {
    return records;
  }
  for (const name of readdirSync(directory).sort()) {
    const match = /^([1-9]\d*)\.json$/.exec(name);
    if (!match) {
      continue;
    }
    const pr = Number(match[1]);
    const record = object(JSON.parse(readFileSync(join(directory, name), "utf8")));
    if (record.pr === pr && (record.repo === undefined || record.repo === repo)) {
      records.set(pr, record);
    }
  }
  return records;
}

function sessionIds(record?: Record<string, unknown>): string[] {
  if (!record) {
    return [];
  }
  const ids = Array.isArray(record.sessionIds)
    ? record.sessionIds
    : Array.isArray(record.ids)
      ? record.ids
      : Array.isArray(record.sessions)
        ? record.sessions.map((session) =>
            typeof session === "string" ? session : object(session).id
          )
        : [record.sessionId ?? record.id];
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

function readLegacyRecords(deps: CostBackfillDependencies, stateRoot: string): Map<number, string> {
  const records = new Map<number, string>();
  const latest = new Map<number, number>();
  const names = Array.isArray(deps.config.legacyWorkers) ? deps.config.legacyWorkers : [];
  for (const value of names) {
    const name = String(value);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(name)) {
      throw new Error("Invalid legacyWorkers relative directory path");
    }
    if (name.split("/").at(-1) === "claude-workers") {
      continue;
    }
    const directory = join(
      stateRoot,
      `${name}${deps.config.track ? `-${String(deps.config.track)}` : ""}`
    );
    if (!existsSync(directory)) {
      continue;
    }
    for (const file of readdirSync(directory).sort()) {
      const marker = file.lastIndexOf(".worktrees_");
      if (marker < 0) {
        continue;
      }
      const basename = file.slice(marker + ".worktrees_".length);
      const prefix = workerWorktreePrefix(deps.config);
      const task = basename.startsWith(prefix)
        ? /^([1-9]\d*)-/.exec(basename.slice(prefix.length))
        : null;
      if (!task) {
        continue;
      }
      const path = join(directory, file);
      const relativePath = relative(realpathSync(stateRoot), realpathSync(path));
      if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
        throw new Error("Legacy path escapes the state root");
      }
      const id = readFileSync(path, "utf8").trim();
      const pr = Number(task[1]);
      const modified = statSync(path).mtimeMs;
      if (/^ses_[\w-]+$/.test(id) && modified >= (latest.get(pr) ?? -1)) {
        records.set(pr, id);
        latest.set(pr, modified);
      }
    }
  }
  return records;
}

async function writeCost(
  deps: CostBackfillDependencies,
  pr: number,
  value: string,
  current?: string | null
): Promise<boolean> {
  if (current === value) {
    return false;
  }
  try {
    await deps.setCost(pr, value);
    return false;
  } catch (error) {
    if (/archived|archived Done/i.test((error as Error).message)) {
      return true;
    }
    throw error;
  }
}

function updateLog(
  path: string,
  records: ReturnType<typeof modelRecords>,
  repo: unknown,
  pr: number,
  usd: number,
  coverage: string
): boolean {
  const record = records.find(
    (item) => item.repo.toLowerCase() === String(repo).toLowerCase() && item.pr === pr
  );
  if (!record || (record.usd !== undefined && record.usd !== null)) {
    return false;
  }
  const updated = {
    ...record,
    usd,
    costSource: "backfill",
    costBasis: "api-list",
    costCoverage: coverage,
  };
  const next =
    records
      .map((item) => (item === record ? updated : item))
      .map((item) => JSON.stringify(item))
      .join("\n") + "\n";
  modelRecords(next);
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, next, { mode: 0o600 });
  renameSync(temporary, path);
  return true;
}
