import { expect, test, vi } from "vitest";
import { GitTransport } from "../../src/gateway/git.js";
import type { Dependencies } from "../../src/gateway/client.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "../helpers.js";
import { runChildAsync } from "../child-process.js";

test("real commit-tree uses wrapper identity even with a conflicting global config", async () => {
  const root = fixture();
  const global = join(root, "global.gitconfig");
  writeFileSync(global, "[user]\nname = Wrong\nemail = wrong@example.com\n");
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    GIT_CONFIG_GLOBAL: global,
    GIT_AUTHOR_NAME: "Author",
    GIT_AUTHOR_EMAIL: "a@example.com",
    GIT_COMMITTER_NAME: "Committer",
    GIT_COMMITTER_EMAIL: "c@example.com",
  };
  const exec: Dependencies["exec"] = async (file, args, options) =>
    (await runChildAsync(file, [...args], { ...options, encoding: "utf8", timeout: 5000 })).stdout;
  const git = new GitTransport({}, env, { exec } as Dependencies, root);
  await git.run("init", "-q");
  const tree = (await git.run("write-tree")).trim();
  const commit = (await git.run("commit-tree", tree, "-m", "test identity")).trim();
  expect((await git.run("show", "-s", "--format=%an <%ae>|%cn <%ce>", commit)).trim()).toBe(
    "Author <a@example.com>|Committer <c@example.com>"
  );
  const missing = new GitTransport(
    {},
    { PATH: env.PATH, HOME: root },
    { exec } as Dependencies,
    root
  );
  await expect(missing.run("commit-tree", tree, "-m", "missing")).rejects.toThrow(
    "set GIT_AUTHOR_NAME/EMAIL"
  );
});

test("commit-tree receives explicit wrapper identities, never global config or secrets", async () => {
  const identity = {
    GIT_AUTHOR_NAME: "Worker",
    GIT_AUTHOR_EMAIL: "worker@example.com",
    GIT_COMMITTER_NAME: "Bot",
    GIT_COMMITTER_EMAIL: "bot@example.com",
  };
  const exec = vi.fn(async () => "commit");
  const git = new GitTransport(
    {},
    { ...identity, SECRET: "hidden" },
    { exec } as unknown as Dependencies,
    "/work"
  );
  await git.run("commit-tree", "tree");
  expect(exec).toHaveBeenCalledWith("git", ["commit-tree", "tree"], {
    cwd: "/work",
    env: {
      ...identity,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
});

test.each([
  {},
  { GIT_AUTHOR_NAME: "Only name" },
  { GIT_AUTHOR_NAME: "Author", GIT_AUTHOR_EMAIL: "a@b" },
])("commit-tree requires all explicit identities: %j", async (env) => {
  const exec = vi.fn(async () => "");
  const git = new GitTransport({}, env, { exec } as unknown as Dependencies, "/work");
  await expect(git.run("commit-tree", "tree")).rejects.toThrow(
    "set GIT_AUTHOR_NAME/EMAIL in the orchestrator environment"
  );
  expect(exec).not.toHaveBeenCalled();
});
