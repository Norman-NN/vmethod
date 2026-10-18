import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { workerWorktree } from "../../src/gateway/worker-path.js";
import { fixture } from "../helpers.js";

test.each(["auto-", ""])(
  "worker path prefix %j: new, existing, fallback and preferred",
  (prefix) => {
    const root = fixture();
    const parent = join(root, "workers");
    const config = {
      branches: { mainCheckout: root, worktreeRoot: "workers", worktreePrefix: prefix },
    };
    const preferred = join(parent, `${prefix}9-task`);
    const legacy = join(parent, "9-task");
    expect(workerWorktree("/not-the-checkout", config, "9-task")).toBe(preferred);
    expect(existsSync(parent)).toBe(false);
    mkdirSync(legacy, { recursive: true });
    expect(workerWorktree(root, config, "9-task")).toBe(legacy);
    expect(workerWorktree(root, config, { directory: legacy })).toBe(legacy);
    expect(readdirSync(parent)).toEqual(["9-task"]); // Lookup never migrates legacy trees.
    mkdirSync(preferred, { recursive: true });
    expect(workerWorktree(root, config, "9-task")).toBe(preferred);
    expect(workerWorktree(root, config, { directory: preferred })).toBe(preferred);
  }
);

test("worker path defaults to auto- and refuses traversal in branch or prefix", () => {
  const root = fixture();
  expect(workerWorktree(root, {}, "9-task")).toBe(join(root, ".worktrees/auto-9-task"));
  for (const branch of ["../escape", "..", ""]) {
    expect(() => workerWorktree(root, {}, branch)).toThrow("escapes");
  }
  expect(() => workerWorktree(root, { branches: { worktreePrefix: "../" } }, "9-task")).toThrow(
    "worktreePrefix"
  );
});
