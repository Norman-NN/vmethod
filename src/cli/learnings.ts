import { context, type Transport } from "../gateway/transport.js";
import type { LearningInput } from "../gateway/learnings.js";

/** Parse the learning CLI without performing filesystem or network operations. */
export async function learningsVerb(
  transport: Transport,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<string> {
  const [action, ...flags] = args;
  const ctx = context(env);
  if (action === "check-pr") {
    if (
      flags.length < 1 ||
      flags.length > 2 ||
      !/^[1-9]\d*$/.test(flags[0]) ||
      (flags[1] !== undefined && flags[1] !== "--label")
    ) {
      throw new Error("Usage: learnings check-pr <pr> [--label] (CI)");
    }
    return transport.call("learningCheck", { ref: flags[0], label: flags[1] === "--label" }, ctx);
  }
  if (!["submit", "show", "report"].includes(action)) {
    throw new Error("Usage: learnings submit|show|report");
  }
  const input: LearningInput = { action: action as LearningInput["action"] };
  const seen = new Set<string>();
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index];
    if (seen.has(flag) && flag !== "--include-text") {
      throw new Error(`Duplicate flag: ${flag}`);
    }
    seen.add(flag);
    if (action === "show" && index === 0 && !flag.startsWith("-")) {
      input.family = flag;
      continue;
    }
    if (action === "report" && flag === "--json") {
      input.json = true;
      continue;
    }
    const allowed =
      action === "submit"
        ? ["--notes", "--include-text"]
        : action === "report"
          ? ["--family", "--kind"]
          : [];
    const value = flags[++index];
    if (!allowed.includes(flag) || !value || value.startsWith("--")) {
      throw new Error(`Invalid learnings argument: ${flag}`);
    }
    if (flag === "--include-text") {
      if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new Error("--include-text requires a PR number");
      }
      (input.includeText ??= []).push(Number(value));
    } else if (flag === "--notes") {
      input.notes = value;
    } else if (flag === "--family") {
      input.family = value;
    } else if (flag === "--kind") {
      input.kind = value;
    }
  }
  return transport.call("learnings", input, ctx);
}
