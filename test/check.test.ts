import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { check } from "../src/check.js";
import { peer, validProject as unpricedProject } from "./helpers.js";
import { parse, stringify } from "yaml";

function validProject() {
  const root = unpricedProject();
  const models = parse(readFileSync(join(root, "models.yaml"), "utf8")) as Record<
    string,
    unknown
  >[];
  writeFileSync(
    join(root, "models.yaml"),
    stringify(models.map((model) => ({ ...model, price: { input: 1, output: 2, cached: 0.1 } })))
  );
  return root;
}

test("missing family price warns without failing or pretending usage is free", () => {
  const result = check(unpricedProject());
  expect(result.code).toBe(0);
  expect(result.messages.length).toBeGreaterThan(0);
  expect(
    result.messages.every((message) => message.includes("has no price; delivery usd is null"))
  ).toBe(true);
});

test("only explicit prerelease deferral softens absent settings, on every run", () => {
  const root = validProject();
  rmSync(join(root, ".claude/settings.json"));
  for (const version of ["0.0.0-dev", "1.0.0-rc.2", "1.1.0-beta.1+build.3"]) {
    for (let run = 0; run < 2; run++) {
      expect(check(root, {}, { deferPermissions: true, version })).toEqual({
        code: 0,
        messages: [
          `WARN permissions deferred (prerelease ${version}): .claude/settings.json not installed`,
        ],
      });
    }
  }
  expect(check(root).code).toBe(1);
  for (const version of ["1.0.0", "1.0.0+rc.2"]) {
    expect(check(root, {}, { deferPermissions: true, version })).toEqual({
      code: 1,
      messages: ["--defer-permissions is only valid on a prerelease"],
    });
  }
  writeFileSync(join(root, "people.yaml"), "invalid: config");
  expect(check(root, {}, { deferPermissions: true }).code).toBe(1);
  rmSync(join(root, "node_modules/mermaid"), { recursive: true });
  expect(check(root, {}, { deferPermissions: true }).code).toBe(2);
});

test("deferral never softens installed invalid settings or unreadable settings paths", () => {
  const root = validProject();
  for (const deferPermissions of [false, true]) {
    expect(check(root, {}, { deferPermissions }).code).toBe(0);
  }
  for (const content of ["{}", "invalid JSON"]) {
    writeFileSync(join(root, ".claude/settings.json"), content);
    for (const deferPermissions of [false, true]) {
      expect(check(root, {}, { deferPermissions }).code).toBe(1);
    }
  }
  rmSync(join(root, ".claude/settings.json"));
  mkdirSync(join(root, ".claude/settings.json"));
  expect(check(root, {}, { deferPermissions: true }).code).toBe(1);
});

test("CODEOWNERS missing coverage warns without failing", () => {
  const root = validProject();
  rmSync(join(root, "CODEOWNERS"));
  expect(check(root)).toEqual({
    code: 0,
    messages: ["vmethod.yaml", "people.yaml", ".claude/"].map(
      (path) => `WARN CODEOWNERS: ${path} has no owner entry`
    ),
  });
  writeFileSync(
    join(root, "CODEOWNERS"),
    "/vmethod.yaml @owner\n/people.yaml @owner\n/.claude/ @owner\n"
  );
  expect(check(root)).toEqual({ code: 0, messages: [] });
  writeFileSync(join(root, "CODEOWNERS"), "*.yaml @owner\n.claude/** @owner\n");
  expect(check(root).messages).toEqual([]);
  writeFileSync(join(root, "CODEOWNERS"), "* @owner\npeople.yaml\n");
  expect(check(root).messages).toEqual(["WARN CODEOWNERS: people.yaml has no owner entry"]);
  writeFileSync(join(root, "CODEOWNERS"), "* @owner\npeople.yaml # deliberately unowned\n");
  expect(check(root).messages).toEqual(["WARN CODEOWNERS: people.yaml has no owner entry"]);
  mkdirSync(join(root, ".github"));
  writeFileSync(join(root, ".github/CODEOWNERS"), "/vmethod.yaml @owner\n");
  expect(check(root).messages).toEqual([
    "WARN CODEOWNERS: people.yaml has no owner entry",
    "WARN CODEOWNERS: .claude/ has no owner entry",
  ]);
  rmSync(join(root, ".github/CODEOWNERS"));
  rmSync(join(root, "CODEOWNERS"));
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs/CODEOWNERS"), "**/*.yaml @owner\n.claud?/ @owner\n");
  expect(check(root).messages).toEqual([]);
  rmSync(join(root, "docs/CODEOWNERS"));
  mkdirSync(join(root, "docs/CODEOWNERS"));
  expect(check(root)).toMatchObject({
    code: 0,
    messages: [expect.stringContaining("cannot read")],
  });
});

test("orchestrator check reports each missing git identity up front, workers do not need it", () => {
  const root = validProject();
  const missing = check(root, { VMETHOD_ROLE: "orchestrator" });
  expect(missing.code).toBe(1);
  for (const key of [
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
  ]) {
    expect(missing.messages.join("\n")).toContain(key);
  }
  expect(check(root, { VMETHOD_ROLE: "worker" }).code).toBe(0);
  expect(
    check(root, {
      VMETHOD_ROLE: "orchestrator",
      GIT_AUTHOR_NAME: "A",
      GIT_AUTHOR_EMAIL: "a@b",
      GIT_COMMITTER_NAME: "C",
      GIT_COMMITTER_EMAIL: "c@b",
    }).code
  ).toBe(0);
});

test("check returns 0 for a valid project, 1 for findings, 2 for a missing dependency", () => {
  const root = validProject();
  expect(check(root)).toEqual({ code: 0, messages: [] });
  peer(root, "11.0.0");
  expect(check(root)).toMatchObject({
    code: 1,
    messages: ["mermaid must equal 12.1.0; installed 11.0.0"],
  });
  rmSync(join(root, "node_modules/mermaid"), { recursive: true });
  expect(check(root)).toMatchObject({
    code: 2,
    messages: ["Dependency missing: install mermaid@12.1.0"],
  });
}, 15000);

test("Claude families require a separately configured worker token", () => {
  const root = validProject();
  writeFileSync(
    join(root, "models.yaml"),
    "- family: sonnet\n  model: claude-test\n  kind: claude\n  gate: none\n  tier: standard\n"
  );
  const path = join(root, "vmethod.yaml");
  const original = readFileSync(path, "utf8");
  expect(original).toContain("  workerGithubToken: EXAMPLE_WORKER_GITHUB_TOKEN\n");
  writeFileSync(path, original.replace("  workerGithubToken: EXAMPLE_WORKER_GITHUB_TOKEN\n", ""));
  expect(check(root)).toMatchObject({ code: 1 });
  expect(check(root).messages.join("\n")).toContain("credentials.workerGithubToken");
  writeFileSync(path, original);
  expect(check(root)).toEqual({ code: 0, messages: [] });
});

test("permissions, numeric ids, model families and secret-looking values are checked without leaking secrets", () => {
  const root = validProject();
  writeFileSync(join(root, ".claude/settings.json"), "{}");
  writeFileSync(join(root, "people.yaml"), "- login: owner\n  id: wrong\n  role: owner\n");
  writeFileSync(
    join(root, "models.yaml"),
    "- family: wrong\n  model: a/b\n  kind: opencode\n  gate: none\n"
  );
  const path = join(root, "vmethod.yaml");
  const token = "ghp_" + "a".repeat(36);
  writeFileSync(path, readFileSync(path, "utf8") + `\ntrack: ${token}\n`);
  const result = check(root);
  expect(result.code).toBe(1);
  expect(result.messages.join("\n")).toContain("Secret-looking config value at track");
  expect(result.messages.join("\n")).not.toContain(token);
  expect(result.messages.join("\n")).toContain("people.yaml:");
  expect(result.messages.join("\n")).toContain("models.yaml:");
  expect(result.messages.join("\n")).toContain("Permission deny rule missing");
  expect(check(root, { VMETHOD_TRACK: "safe-override" }).messages.join("\n")).toContain(
    "environment overrides do not hide stored secrets"
  );
}, 15000);
