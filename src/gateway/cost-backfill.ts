import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { boardCost, dollars, opencodeUsage, type Price } from "../cost.js";
import type { Config } from "../config.js";
import { object } from "./people.js";

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
  setCost(pr: number, value: string): Promise<void>;
  report?(message: string): void;
}

/** Recover per-PR cost from recorded worker sessions without inventing zero for unknown usage. */
export async function backfillCosts(
  deps: CostBackfillDependencies,
  options: CostBackfillOptions = {}
): Promise<string> {
  const stateName = String(deps.config.stateName ?? String(deps.config.repo).replace("/", "-"));
  const stateRoot = deps.env.XDG_STATE_HOME ?? join(deps.env.HOME ?? ".", ".local/state");
  const workers = join(stateRoot, "vmethod", stateName, "workers");
  const records = new Map<number, Record<string, unknown>>();
  if (existsSync(workers)) {
    for (const name of readdirSync(workers).sort()) {
      const match = /^([1-9]\d*)\.json$/.exec(name);
      if (!match) {
        continue;
      }
      const pr = Number(match[1]);
      const record = object(JSON.parse(readFileSync(join(workers, name), "utf8")));
      if (record.pr !== pr || (record.repo !== undefined && record.repo !== deps.config.repo)) {
        continue;
      }
      records.set(pr, record);
    }
  }
  const prs = options.prs?.length
    ? [...new Set(options.prs)]
    : [...records.keys()].sort((a, b) => a - b);
  const lines: string[] = [];
  let known = 0;
  let total = 0;
  for (const pr of prs) {
    const record = records.get(pr);
    const id = typeof record?.id === "string" ? record.id : "";
    if (!id || (record?.model && object(record.model).kind === "claude")) {
      lines.push(`#${pr}: unknown (${id ? "claude session" : "no recoverable session"})`);
      continue;
    }
    const session = await deps.readSession(id).catch((error: Error) => {
      deps.report?.(`OpenCode unavailable; session costs may be unknown (${error.message})`);
      return undefined;
    });
    const sessionRecord = object(session);
    const usage = session ? opencodeUsage(session) : undefined;
    const sessionModel = object(sessionRecord.model);
    const modelId = session
      ? `${String(sessionModel.providerID ?? "")}/${String(sessionModel.id ?? "")}`
      : "";
    const family = deps.models.find((model) => model.model === modelId || model.family === modelId);
    const usd = usage && family ? dollars(usage.tokens, family.price) : null;
    if (usd === null || !family) {
      lines.push(`#${pr}: unknown (session gone or usage/model unavailable)`);
      continue;
    }
    known++;
    total += usd;
    const formatted = boardCost(usd)!;
    if (!options.dryRun) {
      await deps.setCost(pr, formatted);
    }
    lines.push(
      `#${pr}: ${formatted} (${family.family}, session ${id})${options.dryRun ? " [dry run]" : ""}`
    );
  }
  lines.push(`Total: ${known} priced PR(s), ${boardCost(total)}; ${prs.length - known} unknown`);
  return lines.join("\n");
}
