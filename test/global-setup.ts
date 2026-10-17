import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";

/** Isolate state for workers and inherited CLI children, including homedir fallbacks. */
export default function setup() {
  const scratch = resolve(".tmp");
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "vitest-state-"));
  const previous = { HOME: process.env.HOME, XDG_STATE_HOME: process.env.XDG_STATE_HOME };
  process.env.HOME = root;
  process.env.XDG_STATE_HOME = join(root, "xdg");
  return () => {
    for (const key of ["HOME", "XDG_STATE_HOME"] as const) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
    rmSync(root, { recursive: true, force: true });
  };
}
