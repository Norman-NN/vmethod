import { existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { Config } from "../config.js";
import { object } from "./people.js";

/** Resolve a worker directory under worktreeRoot (relative to mainCheckout or root).
 * Existing unprefixed directories are a lookup-only compatibility fallback: never
 * rename them or choose the legacy path when creating a new worktree. A recorded
 * directory can supply the branch for legacy session status reads without fetching
 * task metadata; callers must preserve the recorded session/directory binding.
 */
export function workerWorktree(
  root: string,
  config: Config,
  task: string | { directory: string }
): string {
  const branches = object(config.branches);
  const parent = resolve(
    String(branches.mainCheckout ?? root),
    String(branches.worktreeRoot ?? ".worktrees")
  );
  const prefix = branches.worktreePrefix ?? "auto-";
  if (typeof prefix !== "string" || /[/\\\r\n]/.test(prefix)) {
    throw new Error("Invalid branches.worktreePrefix");
  }
  const recorded = typeof task === "string" ? "" : relative(parent, resolve(task.directory));
  const branch =
    typeof task === "string"
      ? task
      : recorded.startsWith(prefix)
        ? recorded.slice(prefix.length)
        : recorded;
  const target = (name: string) => {
    const directory = resolve(parent, name);
    const path = relative(parent, directory);
    if (
      !path ||
      path === ".." ||
      path.startsWith(`..${sep}`) ||
      resolve(parent, path) !== directory
    ) {
      throw new Error("Worktree escapes branches.worktreeRoot");
    }
    return directory;
  };
  // Validate the branch independently so a prefix cannot disguise a traversal.
  const legacy = target(branch);
  const preferred = target(`${prefix}${branch}`);
  return !existsSync(preferred) && existsSync(legacy) ? legacy : preferred;
}
