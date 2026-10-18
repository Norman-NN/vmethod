import type { Transport } from "../gateway/transport.js";
import type { OpenTaskInput, ReviewInput } from "../gateway/task-flow-types.js";
import { context } from "../gateway/transport.js";

export async function taskFlowVerb(
  transport: Transport,
  verb: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<string> {
  const ctx = context(env);
  if (verb === "ask") {
    if (args.length !== 2) {
      throw new Error("Usage: ask <issue> <file>");
    }
    return transport.call("askIssue", { ref: args[0], file: args[1] }, ctx);
  }
  if (verb === "open-task") {
    const input: OpenTaskInput = {};
    const values = {
      "--direct": "direct",
      "--unapproved": "unapproved",
      "--model": "model",
    } as const;
    const flags = {
      "--hold": "hold",
      "--part": "part",
      "--owner-approved": "ownerApproved",
    } as const;
    const seen = new Set<string>();
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (seen.has(arg)) {
        throw new Error("Duplicate open-task argument");
      }
      seen.add(arg);
      if (Object.hasOwn(values, arg)) {
        const value = args[++i];
        if (!value || value.startsWith("--")) {
          throw new Error(`Missing value for ${arg}`);
        }
        input[values[arg as keyof typeof values]] = value;
      } else if (Object.hasOwn(flags, arg)) {
        input[flags[arg as keyof typeof flags]] = true;
      } else if (/^[1-9]\d*$/.test(arg) && !input.issue) {
        input.issue = arg;
      } else {
        throw new Error(
          "Usage: open-task <issue> [--direct title] [--unapproved reason] [--hold] [--part] [--model family] [--owner-approved]"
        );
      }
    }
    return transport.call("openTask", input, ctx);
  }
  if (verb === "review") {
    if (![3, 5].includes(args.length) || (args.length === 5 && args[3] !== "--in-reply-to")) {
      throw new Error(
        "Usage: review <pr> changes|owner|answer|ask|approve <file> [--in-reply-to url]"
      );
    }
    return transport.call(
      "reviewTask",
      { ref: args[0], outcome: args[1] as ReviewInput["outcome"], file: args[2], replyTo: args[4] },
      ctx
    );
  }
  if (verb === "merge-task") {
    if (!args.length || args.length > 2 || (args[1] && args[1] !== "--merge-commit")) {
      throw new Error("Usage: merge-task <pr> [--merge-commit]");
    }
    return transport.call(
      "mergeTask",
      { ref: args[0], mergeCommit: args[1] === "--merge-commit" },
      ctx
    );
  }
  if (verb === "release-hold" && args.length === 1) {
    return transport.call("releaseHold", { ref: args[0] }, ctx);
  }
  throw new Error("Usage: release-hold <pr>");
}
