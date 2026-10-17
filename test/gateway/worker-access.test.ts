import { expect, test } from "vitest";
import type { Dependencies } from "../../src/gateway/client.js";
import { workerAccess, type WorkerFileStat } from "../../src/gateway/access.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validProject } from "../helpers.js";
import { workerVerb } from "../../src/cli/worker.js";
import type { Transport } from "../../src/gateway/transport.js";

function fixture() {
  const directories = [
    "/repo/.worktrees/task",
    "/repo/.worktrees/task/node_modules",
    "/repo/.worktrees/task/.tmp",
  ];
  const stats = new Map<string, WorkerFileStat>(
    directories.map((path) => [
      path,
      { uid: 1001, gid: 1001, mode: 0o755, directory: true, symlink: false },
    ])
  );
  const file = "/repo/.worktrees/task/index.ts";
  stats.set(file, { uid: 1001, gid: 1001, mode: 0o644, directory: false, symlink: false });
  const calls: string[] = [];
  let groups = "1001 2002";
  const deps: Dependencies = {
    fetch: async () => {
      throw new Error("Unexpected network");
    },
    exec: async (command, args) => {
      calls.push(command);
      if (command === "getent") {
        return "workers:x:2002:one,two";
      }
      if (command === "id") {
        return args[0] === "-u" ? "1001" : groups;
      }
      if (command === "chgrp") {
        stats.get(args[2])!.gid = 2002;
        return "";
      }
      if (command === "setfacl") {
        throw new Error("Not installed");
      }
      throw new Error(`Unexpected command ${command}`);
    },
    now: () => 0,
    sleep: async () => {},
    report: () => {},
    workerFilesystem: {
      stat: (path) => {
        const stat = stats.get(path);
        if (!stat) {
          throw new Error(path);
        }
        return stat;
      },
      children: (path) => (path === directories[0] ? [...directories.slice(1), file] : []),
      chmod: (path, mode) => {
        stats.get(path)!.mode = mode;
      },
      mkdir: () => {},
      realpath: (path) => path,
    },
  };
  return {
    directories,
    stats,
    file,
    calls,
    deps,
    config: { workerUser: "two", workerGroup: "workers", branches: { worktreeRoot: ".worktrees" } },
    setGroups: (value: string) => {
      groups = value;
    },
  };
}

test("file owner can repair group and directory setgid without privileged commands; ACL absence falls back", async () => {
  const f = fixture();
  await workerAccess("/repo", f.directories[0], f.config, f.deps);
  for (const path of f.directories) {
    expect(f.stats.get(path)).toMatchObject({ gid: 2002, mode: 0o2775 });
  }
  expect(f.stats.get(f.file)).toMatchObject({ gid: 2002, mode: 0o664 });
  expect(new Set(f.calls)).toEqual(new Set(["getent", "id", "chgrp", "setfacl"]));
});

test("missing shared-group membership gives an actionable error before changing the tree", async () => {
  const f = fixture();
  f.setGroups("1001");
  await expect(workerAccess("/repo", f.directories[0], f.config, f.deps)).rejects.toThrow(
    "Add both users to group workers"
  );
  expect(f.calls).not.toContain("chgrp");
});

test.each(["node_modules", ".tmp"])(
  "a different owner's non-setgid %s is refused",
  async (name) => {
    const f = fixture();
    for (const stat of f.stats.values()) {
      stat.uid = 2003;
      stat.gid = 2002;
      stat.mode = stat.directory ? 0o2775 : 0o664;
    }
    f.stats.get(`/repo/.worktrees/task/${name}`)!.mode = 0o775;
    await expect(workerAccess("/repo", f.directories[0], f.config, f.deps)).rejects.toThrow(
      "setgid"
    );
  }
);

test("shared worktree preparation brackets npm installation with permission checks and umask 002", async () => {
  const root = validProject();
  const target = join(root, ".worktrees/9-task");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "package-lock.json"), "fake lock");
  const file = join(root, "vmethod.yaml");
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace("/replace/with/consumer/checkout", root) +
      "\nworkerGroup: workers\n"
  );
  const operations: string[] = [];
  const transport: Transport = {
    call: async (operation) => {
      operations.push(operation);
      if (operation === "task") {
        return { branch: "9-task", base: "dev" } as never;
      }
      if (operation === "workerAccess") {
        return "shared" as never;
      }
      throw new Error(`Unexpected operation ${operation}`);
    },
  };
  await workerVerb(
    transport,
    root,
    "start-task",
    ["31"],
    {
      VMETHOD_ROLE: "orchestrator",
      PATH: "fake-path",
      HOME: "fake-home",
      OPENCODE_SERVER_PASSWORD: "secret",
    },
    {
      report: () => {},
      exec: async (command, args, options) => {
        if (command === "sh") {
          expect(args).toEqual(["-c", "umask 002\nexec npm ci"]);
          expect(options.env).toEqual({ HUSKY: "0", PATH: "fake-path", HOME: "fake-home" });
          expect(operations).toEqual(["task", "workerAccess"]);
          operations.push("install");
          return "";
        }
        expect(command).toBe("git");
        const key = args.join(" ");
        if (key === "rev-parse --show-toplevel") {
          return target;
        }
        if (key === "rev-parse --git-common-dir") {
          return join(root, ".git");
        }
        if (key === "rev-parse --git-dir") {
          return join(root, ".git/worktrees/9-task");
        }
        if (key === "rev-parse --abbrev-ref HEAD") {
          return "9-task";
        }
        if (key === "status --porcelain" || key === "branch -q --set-upstream-to=origin/9-task") {
          return "";
        }
        if (key.startsWith("rev-list --count ")) {
          return "1";
        }
        throw new Error(`Unexpected git ${key}`);
      },
    }
  );
  expect(operations).toEqual(["task", "workerAccess", "install", "workerAccess"]);
});
