import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export function fragmentKind(text) {
  const matches = [...text.matchAll(/^kind: (breaking|feature|fix)\r?$/gm)];
  if (matches.length !== 1) {
    throw new Error("Changelog fragment must declare kind: breaking, feature or fix");
  }
  if (text.trim().split(/\r?\n/).length < 3) {
    throw new Error("Changelog fragment must include a description");
  }
  return matches[0][1];
}

export function requirePrFragment(number, learningVerdict, read = readFileSync) {
  if (!/^\d+$/.test(number)) {
    throw new Error("Expected numeric PR number");
  }
  if (learningVerdict.trim() !== `Learning PR #${number}: authorized`) {
    fragmentKind(read(`changes/unreleased/${number}.md`, "utf8"));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const number = process.argv[2];
  if (!/^[1-9]\d*$/.test(number)) {
    throw new Error("Expected numeric PR number");
  }
  // A failed authorization read is fatal, never a fragment exemption.
  const verdict = execFileSync(
    process.execPath,
    ["dist/vmethod.mjs", "learnings", "check-pr", number],
    { encoding: "utf8" }
  );
  requirePrFragment(number, verdict);
}
