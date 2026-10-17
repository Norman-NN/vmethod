import { build } from "esbuild";
import { readFile, readdir, chmod } from "node:fs/promises";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const learnings = {};
async function snapshot(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      await snapshot(path);
    } else if (/\.(md|jsonl)$/.test(entry.name)) {
      learnings[path] = await readFile(path, "utf8");
    }
  }
}
await snapshot("learnings");
const migrations = await Promise.all(
  (await readdir("board/migrations"))
    .filter((name) => /^\d{4}-[a-z0-9-]+\.json$/.test(name))
    .sort()
    .map(async (name) => JSON.parse(await readFile(`board/migrations/${name}`, "utf8")))
);
await build({
  entryPoints: ["src/cli/main.ts"],
  outfile: "dist/vmethod.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  minify: false,
  sourcemap: true,
  splitting: false,
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);',
  },
  define: {
    __VERSION__: JSON.stringify(pkg.version),
    __BOARD_VERSION__: JSON.stringify(pkg.boardVersion),
    __MIGRATIONS__: JSON.stringify(migrations),
    __LEARNINGS__: JSON.stringify(learnings),
  },
});
await chmod("dist/vmethod.mjs", 0o755);
