import { expect, test } from "vitest";
import { taskFlowVerb } from "../src/cli/task-flow.js";
import type { Transport } from "../src/gateway/transport.js";

test("task-flow CLI routes typed inputs and rejects malformed options before transport", async () => {
  const calls: unknown[] = [];
  const transport: Transport = {
    call: async (operation, input, ctx) => {
      calls.push({ operation, input, ctx });
      return "ok" as never;
    },
  };
  const env = { VMETHOD_ROLE: "orchestrator" };
  await taskFlowVerb(
    transport,
    "open-task",
    ["8", "--model", "astra", "--hold", "--owner-approved", "--unapproved", "reproducer"],
    env
  );
  await taskFlowVerb(transport, "open-task", ["--direct", "fix: small task"], env);
  await taskFlowVerb(
    transport,
    "review",
    [
      "27",
      "owner",
      "review.md",
      "--in-reply-to",
      "https://github.com/example/project/pull/27#issuecomment-1",
    ],
    env
  );
  await taskFlowVerb(transport, "merge-task", ["27", "--merge-commit"], env);
  await taskFlowVerb(transport, "release-hold", ["27"], env);
  expect(calls).toEqual([
    {
      operation: "openTask",
      input: {
        issue: "8",
        model: "astra",
        hold: true,
        ownerApproved: true,
        unapproved: "reproducer",
      },
      ctx: { role: "orchestrator" },
    },
    { operation: "openTask", input: { direct: "fix: small task" }, ctx: { role: "orchestrator" } },
    {
      operation: "reviewTask",
      input: {
        ref: "27",
        outcome: "owner",
        file: "review.md",
        replyTo: "https://github.com/example/project/pull/27#issuecomment-1",
      },
      ctx: { role: "orchestrator" },
    },
    {
      operation: "mergeTask",
      input: { ref: "27", mergeCommit: true },
      ctx: { role: "orchestrator" },
    },
    { operation: "releaseHold", input: { ref: "27" }, ctx: { role: "orchestrator" } },
  ]);
  calls.length = 0;
  for (const [verb, args] of [
    ["open-task", ["8", "--unapproved"]],
    ["open-task", ["8", "--hold", "--hold"]],
    ["merge-task", ["27", "--force"]],
    ["review", ["27", "owner"]],
    ["release-hold", []],
  ] as [string, string[]][]) {
    await expect(taskFlowVerb(transport, verb, args, env)).rejects.toThrow();
  }
  expect(calls).toEqual([]);
});
