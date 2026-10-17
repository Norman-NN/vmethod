import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inferWorkerEnvironment } from "../../src/gateway/worker-context.js";
import { fixture } from "../helpers.js";

test("worker context resolves the branch, caches by head and preserves explicit variables", async () => {
  const root = fixture();
  let head = "a".repeat(40);
  let branch = "64-task";
  let calls = 0;
  const reports: string[] = [];
  const deps = {
    exec: async (file: string, args: readonly string[]) => {
      expect(file).toBe("git");
      const command = args.join(" ");
      if (command === "rev-parse --git-dir") {
        return ".git/worktrees/task";
      }
      if (command === "rev-parse --git-common-dir") {
        return ".git";
      }
      if (command === "rev-parse --abbrev-ref HEAD") {
        return branch;
      }
      if (command === "rev-parse HEAD") {
        return head;
      }
      throw new Error(`Unexpected command ${command}`);
    },
    report: (message: string) => reports.push(message),
  };
  const transport = {
    call: async (operation: string, input: unknown, ctx: unknown) => {
      expect(operation).toBe("resolveTask");
      expect(input).toEqual({ branch });
      expect(ctx).toEqual({ role: "worker" });
      calls++;
      return 65 as never;
    },
  };
  const expected = { VMETHOD_ROLE: "worker", VMETHOD_TASK_PR: "65" };
  expect(await inferWorkerEnvironment(root, {}, transport, deps)).toEqual(expected);
  expect(await inferWorkerEnvironment(root, {}, transport, deps)).toEqual(expected);
  expect(calls).toBe(1);
  expect(readFileSync(join(root, ".tmp", "worker-context.json"), "utf8")).toContain(head);
  head = "b".repeat(40);
  expect(await inferWorkerEnvironment(root, {}, transport, deps)).toEqual(expected);
  expect(calls).toBe(2);
  branch = "another-naming-scheme";
  expect(await inferWorkerEnvironment(root, {}, transport, deps)).toEqual(expected);
  expect(calls).toBe(3);
  for (const env of [{ VMETHOD_TASK_PR: "90" }, { VMETHOD_ROLE: "orchestrator" }]) {
    expect(await inferWorkerEnvironment(root, env, transport, deps)).toEqual(env);
  }
  expect(calls).toBe(3);
  expect(reports).toEqual([]);
});

test("unresolved worker context reports the explicit-prefix fallback", async () => {
  const root = fixture();
  const reports: string[] = [];
  const env = await inferWorkerEnvironment(
    root,
    {},
    { call: async () => null as never },
    {
      exec: async (_file, args) => {
        if (args[1] === "--git-dir") {
          return ".git/worktrees/task";
        }
        if (args[1] === "--git-common-dir") {
          return ".git";
        }
        if (args[1] === "--abbrev-ref") {
          return "64-task";
        }
        if (args.join(" ") === "rev-parse HEAD") {
          return "a".repeat(40);
        }
        throw new Error(`Unexpected command ${args.join(" ")}`);
      },
      report: (message) => reports.push(message),
    }
  );
  expect(env).toEqual({});
  expect(reports.join(" ")).toMatch(/VMETHOD_ROLE=worker VMETHOD_TASK_PR/);
});

test.each(["main checkout", "detached HEAD", "lookup failure", "corrupt cache"])(
  "worker inference handles %s without guessing or granting orchestrator context",
  async (scenario) => {
    const root = fixture();
    if (scenario === "corrupt cache") {
      mkdirSync(join(root, ".tmp"));
      writeFileSync(join(root, ".tmp", "worker-context.json"), "not JSON");
    }
    const reports: string[] = [];
    let lookups = 0;
    const env = await inferWorkerEnvironment(
      root,
      {},
      {
        call: async () => {
          lookups++;
          if (scenario === "lookup failure") {
            throw new Error("injected lookup failure");
          }
          if (scenario !== "corrupt cache") {
            throw new Error("Unexpected lookup");
          }
          return 65 as never;
        },
      },
      {
        exec: async (_file, args) => {
          switch (args.join(" ")) {
            case "rev-parse --git-dir":
              return scenario === "main checkout" ? ".git" : ".git/worktrees/task";
            case "rev-parse --git-common-dir":
              return ".git";
            case "rev-parse --abbrev-ref HEAD":
              return scenario === "detached HEAD" ? "HEAD" : "64-task";
            case "rev-parse HEAD":
              return "a".repeat(40);
            default:
              throw new Error(`Unexpected command ${args.join(" ")}`);
          }
        },
        report: (message) => reports.push(message),
      }
    );
    expect(env).toEqual(
      scenario === "corrupt cache" ? { VMETHOD_ROLE: "worker", VMETHOD_TASK_PR: "65" } : {}
    );
    expect(lookups).toBe(["corrupt cache", "lookup failure"].includes(scenario) ? 1 : 0);
    if (scenario === "corrupt cache") {
      expect(reports.join(" ")).toContain("ignoring unreadable worker context cache");
    } else if (scenario === "lookup failure") {
      expect(reports.join(" ")).toContain("injected lookup failure");
      expect(reports.join(" ")).toContain("VMETHOD_ROLE=worker VMETHOD_TASK_PR");
    } else {
      expect(reports).toEqual([]);
    }
  }
);
