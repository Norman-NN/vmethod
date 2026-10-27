import { mkdirSync, mkdtempSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll } from "vitest";
import { init } from "../src/init.js";

export const templates = resolve("templates");
const fixtures: string[] = [];
afterAll(() => {
  for (const root of fixtures) {
    rmSync(root, { recursive: true, force: true });
  }
});
export function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "vmethod-test-"));
  fixtures.push(root);
  return root;
}
const ghConfigs = new Map<string, string>();
/** A gh config directory whose plain-text login holds this token (GH_CONFIG_DIR). */
export function ghConfig(token: string): string {
  let directory = ghConfigs.get(token);
  if (!directory) {
    directory = join(fixture(), "gh");
    mkdirSync(directory);
    writeFileSync(
      join(directory, "hosts.yml"),
      `github.com:\n    oauth_token: ${JSON.stringify(token)}\n    user: fixture\n`
    );
    ghConfigs.set(token, directory);
  }
  return directory;
}
export function validProject(): string {
  const root = fixture();
  init(root, templates);
  mkdirSync(join(root, ".claude"));
  cpSync(join(templates, "claude-settings.json"), join(root, ".claude/settings.json"));
  writeFileSync(join(root, "CODEOWNERS"), "* @owner\n");
  writeFileSync(join(root, ".gitignore"), ".claude/\n");
  peer(root);
  return root;
}
export function peer(root: string, version = "12.1.0"): void {
  const dir = join(root, "node_modules/mermaid");
  mkdirSync(dir, { recursive: true });
  // Metadata-only fixture; any attempt to use a renderer fails loudly.
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "mermaid", version, main: "index.cjs" })
  );
  writeFileSync(
    join(dir, "index.cjs"),
    'throw new Error("Unexpected renderer call on metadata-only fixture");\n'
  );
}
