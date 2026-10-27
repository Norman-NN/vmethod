import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { object } from "./people.js";

/**
 * The GitHub token of the gh login in `GH_CONFIG_DIR`, the only credential source.
 * `GH_TOKEN` is never read: a session inherits it from whatever launched the agent
 * host, so it can name another identity. A plain-text login (`hosts.yml`
 * `oauth_token`) is read directly; a keyring login is asked of `gh auth token`
 * with the same config directory and no inherited token.
 */
export function githubToken(env: NodeJS.ProcessEnv): string {
  const directory = env.GH_CONFIG_DIR;
  if (!directory) {
    throw new Error("Missing GH_CONFIG_DIR: set it to the gh config directory of this identity");
  }
  let hosts: unknown;
  try {
    hosts = parse(readFileSync(join(directory, "hosts.yml"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Unreadable ${join(directory, "hosts.yml")}`, { cause: error });
    }
    throw new Error(`No gh login in GH_CONFIG_DIR ${directory}; run gh auth login there`, {
      cause: error,
    });
  }
  const host = object(object(hosts)["github.com"]);
  if (typeof host.oauth_token === "string" && host.oauth_token) {
    return host.oauth_token;
  }
  let token = "";
  try {
    token = execFileSync("gh", ["auth", "token", "--hostname", "github.com"], {
      encoding: "utf8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        GH_CONFIG_DIR: directory,
        ...(env.PATH ? { PATH: env.PATH } : {}),
        ...(env.HOME ? { HOME: env.HOME } : {}),
      },
    }).trim();
  } catch {
    // Reported below without gh's output, which may describe the keyring.
  }
  if (!token) {
    throw new Error(`No GitHub token for github.com in GH_CONFIG_DIR ${directory}`);
  }
  return token;
}
