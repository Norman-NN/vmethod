import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WorkerDependencies } from "./worker-verbs.js";
import type { Transport } from "./transport.js";

/** Infer only worker scope in a linked worktree; explicit environment context always wins.
 * Cache a unique gateway resolution by branch and head SHA in the worktree's scratch directory.
 */
export async function inferWorkerEnvironment(
  root: string,
  env: NodeJS.ProcessEnv,
  transport: Transport,
  deps: WorkerDependencies
): Promise<NodeJS.ProcessEnv> {
  if (env.VMETHOD_ROLE !== undefined || env.VMETHOD_TASK_PR !== undefined) {
    return env;
  }
  const git = async (...args: string[]) =>
    (await deps.exec("git", ["rev-parse", ...args], { cwd: root })).trim();
  try {
    if (resolve(root, await git("--git-dir")) === resolve(root, await git("--git-common-dir"))) {
      return env;
    }
    const branch = await git("--abbrev-ref", "HEAD");
    const head = await git("HEAD");
    if (branch === "HEAD" || !/^[a-f\d]{40}$/i.test(head)) {
      return env;
    }
    const file = join(root, ".tmp", "worker-context.json");
    let taskPr: number | null = null;
    if (existsSync(file)) {
      try {
        const cache = JSON.parse(readFileSync(file, "utf8"));
        if (
          cache.branch === branch &&
          cache.head === head &&
          Number.isSafeInteger(cache.taskPr) &&
          cache.taskPr > 0
        ) {
          taskPr = cache.taskPr;
        }
      } catch (error) {
        deps.report(
          `vmethod: ignoring unreadable worker context cache: ${(error as Error).message}`
        );
      }
    }
    if (taskPr === null) {
      taskPr = await transport.call("resolveTask", { branch }, { role: "worker" });
      if (taskPr === null) {
        deps.report(
          "vmethod: no unique open task PR for this branch; use VMETHOD_ROLE=worker VMETHOD_TASK_PR=<assigned PR number>"
        );
        return env;
      }
      if (!Number.isSafeInteger(taskPr) || taskPr < 1) {
        throw new Error("Invalid resolved task PR");
      }
      mkdirSync(join(root, ".tmp"), { recursive: true });
      writeFileSync(file, JSON.stringify({ branch, head, taskPr }) + "\n");
    }
    return { ...env, VMETHOD_ROLE: "worker", VMETHOD_TASK_PR: String(taskPr) };
  } catch (error) {
    deps.report(
      `vmethod: worker context inference failed: ${(error as Error).message}; use VMETHOD_ROLE=worker VMETHOD_TASK_PR=<assigned PR number>`
    );
    return env;
  }
}
