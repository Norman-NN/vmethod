import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { validateYaml, type Config } from "../config.js";
import { learningReport, modelRecord, modelRecords, type ModelRecord } from "../learnings.js";
import { GitHubClient, GitHubHttpError, type Dependencies } from "./client.js";
import { stateRoot } from "./digest.js";
import { learningAuthor, learningPaths } from "./learning-policy.js";
import { object, untrusted, type Person } from "./people.js";
import { checkMarkdown, guardClosingKeywords } from "./markdown.js";

declare const __LEARNINGS__: Record<string, string>;
const central = "vworlds/vmethod";
const base = "dev";
const families = new Set([
  "sol",
  "luna",
  "astra",
  "sonnet",
  "opus",
  "glm",
  "glm-flash",
  "big-pickle",
  "other",
]);
const tags = new Set(
  "clean weak-tests test-reads-source silent-patch-harness duplication scope-creep cheap-workaround swallowed-failure budget-regression fix-worsened-baseline metrics-pass-feel-fails missed-root-cause doc-misplaced committed-artefacts silent-stall retry-reported-as-blocked ran-full-suite crossed-messages found-root-cause security-catch good-design-question stop-and-ask could-use-cheaper".split(
    " "
  )
);
const reasons = new Set(["start", "quota", "escalation", "rebase", "owner-request"]);
const kinds = new Set([
  "tooling",
  "tooling-security",
  "docs",
  "bug",
  "gameplay",
  "architecture",
  "security",
  "design",
  "other",
]);

export interface LearningInput {
  action: "submit" | "show" | "report";
  family?: string;
  kind?: string;
  json?: boolean;
  notes?: string;
  includeText?: number[];
}

/** Private reduction reconstructs every field; no unconstrained narrative survives by copying. */
export function privateLearning(record: ModelRecord, includeText = false): ModelRecord {
  return modelRecord({
    date: record.date,
    repo: record.repo,
    pr: record.pr,
    task: includeText ? record.task : "",
    notes: includeText ? record.notes : "",
    kind: kinds.has(record.kind) ? record.kind : "other",
    segments: record.segments.map((segment) => ({
      family: families.has(segment.family) ? segment.family : "other",
      model: families.has(segment.family) ? segment.family : "other",
      rounds: segment.rounds,
      why: reasons.has(segment.why) ? segment.why : "redacted",
    })),
    points_open: record.points_open,
    points_final: record.points_final,
    rounds: record.rounds,
    round_causes: record.round_causes,
    prompt_defects: record.prompt_defects,
    outcome: record.outcome,
    stalls: record.stalls.map((stall) => ({
      minutes: stall.minutes,
      cause: "",
      detected_by: stall.detected_by,
    })),
    findings: record.findings
      .filter((finding) => tags.has(finding.tag))
      .map((finding) => ({
        tag: finding.tag,
        caught_by: finding.caught_by,
        ...(finding.root_cause_by ? { root_cause_by: finding.root_cause_by } : {}),
      })),
  });
}

/**
 * Server-only learning reads and fork writes; credentials never cross the typed operation seam.
 * Submissions use the fork dev parent/tree without workflow scope and require byte-identical
 * project log and submitted notes on fork/central dev before creating submission objects.
 */
export class LearningsService {
  constructor(
    private root: string,
    private config: Config,
    private env: NodeJS.ProcessEnv,
    private deps: Dependencies,
    private github: () => GitHubClient,
    private snapshot: Record<string, string> = typeof __LEARNINGS__ === "undefined"
      ? {}
      : __LEARNINGS__
  ) {}

  async command(input: LearningInput): Promise<string> {
    if (input.family !== undefined && !/^[a-z][a-z0-9-]*$/.test(input.family)) {
      throw new Error("Invalid learning family");
    }
    switch (input.action) {
      case "show":
        return this.show(input.family);
      case "report":
        return this.report(input);
      case "submit":
        return this.submit(input);
      default:
        throw new Error("Unknown learnings action");
    }
  }

  async show(family?: string): Promise<string> {
    if (family !== undefined && !/^[a-z][a-z0-9-]*$/.test(family)) {
      throw new Error("Invalid learning family");
    }
    const paths = [...(family ? [`learnings/models/${family}.md`] : []), "learnings/lessons.md"];
    const output: string[] = [];
    for (const path of paths) {
      let content: string | undefined;
      let origin = `${central}:${base}`;
      let unavailable = false;
      try {
        content = await this.content(central, path, base);
      } catch (error) {
        unavailable = true;
        this.deps.report(
          `Learnings remote unavailable: ${(error as Error).message}; using bundled snapshot`
        );
      }
      if (unavailable) {
        content = this.snapshot[path];
        origin = "bundled snapshot";
      }
      output.push(
        `from ${origin} (${path})\n${untrusted(content ?? (unavailable ? "No page in bundled snapshot; central read failed" : "No page on central dev"))}`
      );
    }
    return output.join("\n\n");
  }

  private report(input: LearningInput): string {
    const directory = join(this.root, "learnings/models");
    const texts = existsSync(directory)
      ? readdirSync(directory)
          .filter((name) => name.endsWith(".jsonl"))
          .sort()
          .map((name) => readFileSync(join(directory, name), "utf8"))
      : Object.entries(this.snapshot)
          .filter(([path]) => /^learnings\/models\/[^/]+\.jsonl$/.test(path))
          .map(([, text]) => text);
    if (!texts.length) {
      throw new Error("No model-log inputs available for report");
    }
    const report = learningReport(modelRecords(texts.join("\n")), input.family, input.kind);
    if (input.json) {
      return JSON.stringify(report, null, 2);
    }
    return plainReport(report);
  }

  private async submit(input: LearningInput): Promise<string> {
    if (!["public", "private"].includes(String(this.config.learningsPrivacy))) {
      throw new Error("Set learningsPrivacy explicitly before submitting");
    }
    if (this.config.learningsPrivacy === "private" && input.notes !== undefined) {
      throw new Error(
        "Private distilled notes cannot be cleared per record; use record notes with --include-text <pr>"
      );
    }
    const records = modelRecords(readFileSync(join(this.root, ".vmethod/model-log.jsonl"), "utf8"));
    const repo = String(this.config.repo).toLowerCase();
    if (records.some((record) => record.repo.toLowerCase() !== repo)) {
      throw new Error("Model log contains a foreign repository");
    }
    const included = input.includeText ?? [];
    if (
      included.some(
        (pr) => !Number.isSafeInteger(pr) || pr < 1 || !records.some((record) => record.pr === pr)
      )
    ) {
      throw new Error("--include-text must name an existing delivery PR");
    }
    const directory = stateRoot(this.env, String(this.config.stateName ?? repo.replace("/", "-")));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const lock = join(directory, "learnings.lock");
    try {
      mkdirSync(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(
          "Learning submission locked; confirm no submission is running before removing a stale lock",
          { cause: error }
        );
      }
      throw error;
    }
    try {
      return await this.submitLocked(input, records, repo, directory, included);
    } finally {
      rmdirSync(lock);
    }
  }

  private async submitLocked(
    input: LearningInput,
    records: ModelRecord[],
    repo: string,
    directory: string,
    included: number[]
  ): Promise<string> {
    const state = join(directory, "learnings.json");
    const cursor = existsSync(state)
      ? object(JSON.parse(readFileSync(state, "utf8")))
      : { count: 0, prefix: digest([]) };
    const count = Number(cursor.count);
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > records.length ||
      cursor.prefix !== digest(records.slice(0, count))
    ) {
      throw new Error("Submitted model-log prefix changed; reconcile cursor before submitting");
    }
    const github = this.github();
    const registry = await this.content(central, "people.yaml", base);
    if (registry === undefined) {
      throw new Error("Missing central learning authorization registry");
    }
    const people = validateYaml(registry, "people", `${central}:people.yaml`) as Person[];
    const viewer = object(await github.rest("/user"));
    const person = learningAuthor(people, viewer, repo);
    const rawNotes = input.notes === undefined ? undefined : readFileSync(input.notes, "utf8");
    if (rawNotes !== undefined) {
      await checkMarkdown(this.root, rawNotes);
      guardClosingKeywords(rawNotes);
    }
    const fresh = records
      .slice(count)
      .map((record) =>
        this.config.learningsPrivacy === "private"
          ? privateLearning(record, included.includes(record.pr))
          : record
      );
    if (included.some((pr) => records.slice(0, count).some((record) => record.pr === pr))) {
      throw new Error("--include-text cannot amend previously submitted records");
    }
    if (!fresh.length && (rawNotes === undefined || digest(rawNotes) === cursor.notes)) {
      return "No new learnings to submit";
    }
    if (cursor.url !== undefined) {
      const priorNumber = /^https:\/\/github\.com\/vworlds\/vmethod\/pull\/([1-9]\d*)$/.exec(
        String(cursor.url)
      )?.[1];
      if (!priorNumber) {
        throw new Error("Invalid prior submission receipt");
      }
      const priorPr = object(await github.rest(`/repos/${central}/pulls/${priorNumber}`));
      if (priorPr.merged_at == null) {
        throw new Error(
          "Previous learning submission is not merged; merge it or reconcile its cursor before submitting more"
        );
      }
    }
    const [owner, name] = repo.split("/");
    const modelPath = `learnings/models/${owner}-${name}.jsonl`;
    const notesPath = `learnings/notes/${name}.md`;
    const baseRef = object(await github.rest(`/repos/${central}/git/ref/heads/${base}`));
    const parent = sha(object(baseRef.object).sha);
    const centralLog = await this.contentBytes(central, modelPath, parent);
    const centralNotes =
      rawNotes === undefined ? undefined : await this.contentBytes(central, notesPath, parent);
    const previous = centralLog?.toString("utf8") ?? "";
    const shared = modelRecords(previous);
    if (shared.some((record) => record.repo.toLowerCase() !== repo)) {
      throw new Error("Shared model log contains a foreign repository");
    }
    for (const record of fresh) {
      const prior = shared.find(
        (entry) => entry.repo.toLowerCase() === repo && entry.pr === record.pr
      );
      if (prior && !isDeepStrictEqual(prior, record)) {
        throw new Error("Conflicting shared delivery; reconcile before resubmitting");
      }
      if (!prior) {
        shared.push(record);
      }
    }
    const files = [
      ...(fresh.length
        ? [
            {
              path: modelPath,
              content: shared.map((record) => JSON.stringify(record)).join("\n") + "\n",
            },
          ]
        : []),
      ...(rawNotes === undefined ? [] : [{ path: notesPath, content: rawNotes }]),
    ];
    if (fresh.length && previous === files.find((file) => file.path === modelPath)?.content) {
      files.splice(
        files.findIndex((file) => file.path === modelPath),
        1
      );
    }
    if (rawNotes !== undefined && centralNotes?.toString("utf8") === rawNotes) {
      files.splice(
        files.findIndex((file) => file.path === notesPath),
        1
      );
    }
    const receipt = {
      count: records.length,
      prefix: digest(records),
      notes: rawNotes === undefined ? cursor.notes : digest(rawNotes),
    };
    if (!files.length) {
      this.saveCursor(state, { ...receipt, sharedAt: parent });
      return "Records and notes already shared on dev; cursor reconciled";
    }
    learningPaths(
      people,
      viewer,
      repo,
      files.map((file) => ({ filename: file.path, status: "modified" }))
    );
    const forkName = `${person.login}/vmethod`;
    let fork: Record<string, unknown>;
    try {
      fork = object(await github.rest(`/repos/${forkName}`));
    } catch (error) {
      if (!(error instanceof GitHubHttpError) || error.status !== 404) {
        throw error;
      }
      await github.rest(`/repos/${central}/forks`, "POST", {}, false);
      fork = {};
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          fork = object(await github.rest(`/repos/${forkName}`));
          break;
        } catch (error) {
          if (!(error instanceof GitHubHttpError) || error.status !== 404 || attempt === 4) {
            throw error;
          }
          await this.deps.sleep(1000 * (attempt + 1));
        }
      }
    }
    if (
      fork.fork !== true ||
      String(fork.full_name).toLowerCase() !== forkName.toLowerCase() ||
      object(fork.owner).id !== person.id ||
      String(object(fork.parent).full_name).toLowerCase() !== central
    ) {
      throw new Error("Refusing an unrelated or unverified fork");
    }
    const forkRef = object(await github.rest(`/repos/${forkName}/git/ref/heads/${base}`));
    const forkParent = sha(object(forkRef.object).sha);
    const expectedContents: [string, Buffer | undefined][] = [[modelPath, centralLog]];
    if (rawNotes !== undefined) {
      expectedContents.push([notesPath, centralNotes]);
    }
    for (const [path, content] of expectedContents) {
      if (!isDeepStrictEqual(await this.contentBytes(forkName, path, forkParent), content)) {
        throw new Error(
          `fork dev is stale for ${path}; sync the fork in the GitHub web UI, then retry`
        );
      }
    }
    const branch = `learnings/${owner}-${name}-${digest({ count, files }).slice(0, 24)}`;
    const refPath = `/repos/${forkName}/git/ref/heads/${branch}`;
    let head: string | undefined;
    try {
      head = sha(object(object(await github.rest(refPath)).object).sha);
    } catch (error) {
      if (!(error instanceof GitHubHttpError) || error.status !== 404) {
        throw error;
      }
    }
    if (head) {
      for (const file of files) {
        if ((await this.content(forkName, file.path, head)) !== file.content) {
          throw new Error("Existing submission branch differs; refusing to overwrite");
        }
      }
      const comparison = object(
        await github.rest(`/repos/${forkName}/compare/${forkParent}...${head}`)
      );
      if (!Array.isArray(comparison.files) || comparison.files.length !== files.length) {
        throw new Error("Existing submission branch has unexpected changes");
      }
      learningPaths(
        people,
        viewer,
        repo,
        comparison.files.map((value) => {
          const file = object(value);
          return {
            filename: String(file.filename),
            status: String(file.status),
            ...(file.previous_filename === undefined
              ? {}
              : { previous_filename: String(file.previous_filename) }),
          };
        })
      );
    } else {
      const commit = object(await github.rest(`/repos/${forkName}/git/commits/${forkParent}`));
      const tree = object(
        await github.rest(
          `/repos/${forkName}/git/trees`,
          "POST",
          {
            base_tree: sha(object(commit.tree).sha),
            tree: files.map((file) => ({ ...file, mode: "100644", type: "blob" })),
          },
          false
        )
      );
      const created = object(
        await github.rest(
          `/repos/${forkName}/git/commits`,
          "POST",
          {
            message: "docs: share project learnings",
            tree: sha(tree.sha),
            parents: [forkParent],
          },
          false
        )
      );
      head = sha(created.sha);
      await github.rest(
        `/repos/${forkName}/git/refs`,
        "POST",
        { ref: `refs/heads/${branch}`, sha: head },
        false
      );
    }
    const existing = await github.rest(
      `/repos/${central}/pulls?state=all&head=${encodeURIComponent(`${person.login}:${branch}`)}&base=${base}&per_page=100`
    );
    if (!Array.isArray(existing) || existing.length > 1) {
      throw new Error("Ambiguous submission PR state");
    }
    let pr = object(existing[0]);
    if (!existing.length) {
      pr = object(
        await github.rest(
          `/repos/${central}/pulls`,
          "POST",
          {
            title: "docs: share project learnings",
            head: `${person.login}:${branch}`,
            base,
            body: `Learning submission for ${repo}. Central automation validates project authorization and applies the learning label.`,
          },
          false
        )
      );
    }
    const url = String(pr.html_url);
    learningAuthor(people, pr.user, repo);
    if (
      !/^https:\/\/github\.com\/vworlds\/vmethod\/pull\/[1-9]\d*$/.test(url) ||
      object(pr.head).sha !== head ||
      object(pr.head).ref !== branch ||
      String(object(object(pr.head).repo).full_name).toLowerCase() !== forkName.toLowerCase() ||
      object(pr.base).ref !== base ||
      object(object(pr.base).repo).full_name !== central ||
      (pr.state !== "open" && pr.merged_at == null)
    ) {
      throw new Error(
        "Submission PR is mismatched or closed unmerged; reconcile before advancing cursor"
      );
    }
    this.saveCursor(state, { ...receipt, url });
    return `Submitted ${fresh.length} records: ${url}\nLearning label pending central validation`;
  }

  private saveCursor(path: string, value: unknown): void {
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    renameSync(temporary, path);
  }

  private async content(repo: string, path: string, ref: string): Promise<string | undefined> {
    return (await this.contentBytes(repo, path, ref))?.toString("utf8");
  }

  private async contentBytes(repo: string, path: string, ref: string): Promise<Buffer | undefined> {
    let data;
    try {
      data = object(
        await this.github().rest(`/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`)
      );
    } catch (error) {
      if (error instanceof GitHubHttpError && error.status === 404) {
        return undefined;
      }
      throw error;
    }
    if (
      data.type !== "file" ||
      data.encoding !== "base64" ||
      typeof data.content !== "string" ||
      data.path !== path
    ) {
      throw new Error("Invalid learning content response");
    }
    return Buffer.from(data.content, "base64");
  }
}

function plainReport(report: ReturnType<typeof learningReport>): string {
  const ratio = (value: number | null) => (value === null ? "n/a" : value.toFixed(2));
  const counts = (title: string, values: Record<string, number>, rates = false) => [
    `${title}:`,
    ...Object.entries(values)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `  ${key}: ${rates ? ratio(value) : value}`),
    ...(Object.keys(values).length ? [] : ["  none"]),
  ];
  const group = (value: typeof report | (typeof report.byFamily)[string]) => [
    `Deliveries: ${value.deliveries}; rounds: ${value.rounds}; points: ${value.points}; rounds per point: ${ratio(value.roundsPerPoint)}`,
    ...counts("Finding rates", value.findingsRate, true),
    ...counts("Caught by", value.caughtBy),
    ...counts("Outcomes", value.outcomes),
    ...counts("Switch reasons", value.switchReasons),
  ];
  return [
    ...group(report),
    ...(
      [
        ["By family", report.byFamily],
        ["By kind", report.byKind],
      ] as const
    ).flatMap(([title, groups]) => [
      title,
      ...Object.entries(groups).flatMap(([name, value]) => [
        `  ${name}`,
        ...group(value).map((line) => `    ${line}`),
      ]),
    ]),
  ].join("\n");
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function sha(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) {
    throw new Error("Missing Git object SHA");
  }
  return value;
}
