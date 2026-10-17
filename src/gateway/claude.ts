import { spawn } from "node:child_process";
import { closeSync, constants, openSync, readFileSync } from "node:fs";

export interface ProcessIdentity {
  pid: number;
  born: string;
}
export interface ProcessRuntime {
  launch(input: {
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    prompt: string;
    log: string;
  }): Promise<ProcessIdentity>;
  alive(identity: ProcessIdentity): boolean;
  stop(identity: ProcessIdentity): void;
}

function born(pid: number): string {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  if (fields[0] === "Z") {
    throw new Error("Claude process exited");
  }
  return fields[19];
}

export const processes: ProcessRuntime = {
  async launch(input) {
    const log = openSync(
      input.log,
      constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
      0o600
    );
    try {
      const child = spawn("claude", input.args, {
        cwd: input.cwd,
        env: input.env,
        detached: true,
        stdio: ["pipe", log, log],
      });
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      const pid = child.pid!;
      const identity = { pid, born: born(pid) };
      await new Promise<void>((resolve, reject) => {
        child.stdin!.once("error", reject);
        child.stdin!.end(input.prompt, () => resolve());
      });
      child.unref();
      return identity;
    } finally {
      closeSync(log);
    }
  },
  alive(identity) {
    try {
      return born(identity.pid) === identity.born;
    } catch {
      return false;
    }
  },
  stop(identity) {
    if (this.alive(identity)) {
      process.kill(-identity.pid, "SIGTERM");
    }
  },
};
