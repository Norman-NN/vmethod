import { readFileSync } from "node:fs";
import { join } from "node:path";
import { taskEnvironmentFile } from "./worker-launch.js";

/** The only variables a task environment file may set. */
const taskVariables = new Set(["VMETHOD_ROLE", "VMETHOD_TASK_PR"]);

/**
 * Load the task environment `worker start` wrote into a worker worktree
 * (`.vmethod/.env`), so worker verbs never need the PR spelled out. Only
 * VMETHOD_ROLE and VMETHOD_TASK_PR are read; a variable already set in the
 * environment wins, so an explicit override still applies.
 */
export function taskEnvironment(root: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  let text: string;
  try {
    text = readFileSync(join(root, taskEnvironmentFile), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return env;
    }
    throw error;
  }
  const loaded: NodeJS.ProcessEnv = {};
  for (const line of text.split(/\r?\n/)) {
    const entry = /^\s*([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (entry && taskVariables.has(entry[1])) {
      loaded[entry[1]] = entry[2].trim();
    } else if (line.trim() && !line.trim().startsWith("#")) {
      throw new Error(`Invalid line in ${taskEnvironmentFile}: ${JSON.stringify(line)}`);
    }
  }
  return { ...loaded, ...env };
}
