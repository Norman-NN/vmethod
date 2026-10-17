import { expect, test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fixture } from "./helpers.js";
import { runChild } from "./child-process.js";
// @ts-expect-error The repository build scripts are plain JavaScript.
import { requirePrFragment } from "../scripts/changelog.mjs";

test("authorized learning 47 never reads a release fragment", () => {
  expect(
    requirePrFragment("47", "Learning PR #47: authorized\n", () => {
      throw new Error("Unexpected fragment read");
    })
  ).toBeUndefined();
});

test.each(["Not a learning submission", "Learning PR #48: authorized", "", "forged authorized"])(
  "every non-authorized verdict requires the fragment: %s",
  (verdict) => {
    const reads: string[] = [];
    requirePrFragment("47", verdict, (path: string) => {
      reads.push(path);
      return "kind: fix\n\nA normal delivery.\n";
    });
    expect(reads).toEqual(["changes/unreleased/47.md"]);
    expect(() =>
      requirePrFragment("47", verdict, () => {
        throw new Error("ENOENT changes/unreleased/47.md");
      })
    ).toThrow("ENOENT");
  }
);

test.each(["authorized", "ordinary", "failed"])(
  "fragment CLI preserves gateway outcome: %s",
  (scenario) => {
    const root = fixture();
    mkdirSync(join(root, "dist"));
    // Loud CLI fake: exact verb/PR required; even forged stdout cannot hide exit 1.
    writeFileSync(
      join(root, "dist/vmethod.mjs"),
      `
      import assert from 'node:assert/strict';
      assert.deepEqual(process.argv.slice(2), ['learnings', 'check-pr', '47']);
      console.log(${JSON.stringify(scenario === "ordinary" ? "Not a learning submission" : "Learning PR #47: authorized")});
      process.exitCode = ${scenario === "failed" ? 1 : 0};
    `
    );
    const result = runChild(process.execPath, [resolve("scripts/changelog.mjs"), "47"], {
      cwd: root,
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status).toBe(scenario === "authorized" ? 0 : 1);
    if (scenario === "ordinary") {
      expect(result.stderr).toContain("ENOENT");
    }
    if (scenario === "failed") {
      expect(result.stderr).toContain("Command failed");
    }
  },
  10000
);
