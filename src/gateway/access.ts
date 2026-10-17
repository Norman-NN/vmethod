import { chmodSync, lstatSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Config } from "../config.js";
import type { Dependencies } from "./client.js";

export interface WorkerFileStat {
  uid: number;
  gid: number;
  mode: number;
  directory: boolean;
  symlink: boolean;
}
export interface WorkerFilesystem {
  stat(path: string): WorkerFileStat;
  children(path: string): string[];
  chmod(path: string, mode: number): void;
  mkdir(path: string): void;
  realpath(path: string): string;
}
const filesystem: WorkerFilesystem = {
  stat(path) {
    const stat = lstatSync(path);
    return {
      uid: stat.uid,
      gid: stat.gid,
      mode: stat.mode,
      directory: stat.isDirectory(),
      symlink: stat.isSymbolicLink(),
    };
  },
  children: (path) => readdirSync(path).map((name) => join(path, name)),
  chmod: chmodSync,
  mkdir: (path) => {
    mkdirSync(path, { recursive: true, mode: 0o2775 });
  },
  realpath: realpathSync,
};

/** Unprivileged group sharing. Never change another user's ownership or login. */
export async function workerAccess(
  root: string,
  directory: string,
  config: Config,
  deps: Dependencies
): Promise<string> {
  const fs = deps.workerFilesystem ?? filesystem;
  const branches = config.branches as { mainCheckout?: string; worktreeRoot?: string } | undefined;
  const parent = fs.realpath(
    resolve(branches?.mainCheckout ?? root, branches?.worktreeRoot ?? ".worktrees")
  );
  const target = fs.realpath(directory);
  if (!target.startsWith(`${parent}${sep}`)) {
    throw new Error("Worker directory escapes worktree root");
  }
  fs.mkdir(resolve(target, ".tmp"));
  if (!config.workerUser && !config.workerGroup) {
    return "Worker access uses the launching OS identity";
  }
  const user = config.workerUser;
  const group = config.workerGroup;
  if (
    user !== undefined &&
    (typeof user !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_-]*\$?$/.test(user))
  ) {
    throw new Error("Invalid workerUser");
  }
  if (typeof group !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_-]*\$?$/.test(group)) {
    throw new Error(
      "Configure workerGroup shared by the worker and orchestrator; add both users to that group"
    );
  }
  const run = (file: string, args: string[]) =>
    deps.exec(file, args, { cwd: root, env: { PATH: process.env.PATH } });
  const groupEntry = (await run("getent", ["group", group])).trim().split(":");
  const gid = Number(groupEntry[2]);
  const uidText = (await run("id", ["-u"])).trim();
  if (!Number.isSafeInteger(gid) || !/^\d+$/.test(uidText)) {
    throw new Error(`Cannot resolve shared group ${group}; add both users to group ${group}`);
  }
  const uid = Number(uidText);
  const memberships = [
    (await run("id", ["-G"])).trim(),
    ...(user ? [(await run("id", ["-G", user])).trim()] : []),
  ];
  if (memberships.some((line) => !line.split(/\s+/).includes(String(gid)))) {
    throw new Error(
      `Add both users to group ${group} and start a new login before preparing workers`
    );
  }
  fs.mkdir(resolve(target, "node_modules"));
  for (const name of ["node_modules", ".tmp"]) {
    if (!fs.realpath(resolve(target, name)).startsWith(`${target}${sep}`)) {
      throw new Error(`Worker ${name} escapes task worktree`);
    }
  }
  const inspect = (path: string) => {
    const stat = fs.stat(path);
    const required = stat.directory ? 0o2070 : 0o060 | (stat.mode & 0o111 ? 0o010 : 0);
    if (stat.gid !== gid || (stat.mode & required) !== required) {
      throw new Error(
        `Worker access: ${path} must use group ${group}${stat.directory ? ", setgid and g+rwx" : " and g+rwX"}; run as the worker user (or file owner) to repair it`
      );
    }
  };
  const prepare = async (path: string): Promise<void> => {
    let stat = fs.stat(path);
    if (stat.symlink) {
      return;
    }
    if (stat.uid === uid) {
      try {
        if (stat.gid !== gid) {
          await run("chgrp", ["--", group, path]);
        }
        stat = fs.stat(path);
        fs.chmod(
          path,
          stat.mode | (stat.directory ? 0o2070 : 0o060 | (stat.mode & 0o111 ? 0o010 : 0))
        );
      } catch {
        throw new Error(
          `Cannot share ${path} with group ${group}; add both users to group ${group}, or run as the worker user/file owner`
        );
      }
    }
    inspect(path);
    if (stat.directory) {
      // ACL tools are optional. Group ownership, setgid and mode checks are the
      // correctness path even when a filesystem does not support default ACLs.
      try {
        await run("setfacl", ["-d", "-m", "u::rwx,g::rwx,o::rx", "--", path]);
      } catch {
        /* optional ACL: group-mode fallback */
      }
      for (const child of fs.children(path)) {
        await prepare(child);
      }
    }
  };
  await prepare(target);
  for (const path of [target, resolve(target, "node_modules"), resolve(target, ".tmp")]) {
    inspect(path);
  }
  return `Worker access ready for shared group ${group}`;
}
