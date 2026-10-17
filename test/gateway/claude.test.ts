import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { processes } from "../../src/gateway/claude.js";
import { fixture } from "../helpers.js";

test("native headless runtime uses stdin and environment, guards reused PIDs and stops the process group", async () => {
  const root = fixture();
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "claude.log");
  writeFileSync(
    join(bin, "claude"),
    `#!${process.execPath}
let text=''; process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>text+=chunk);
process.stdin.on('end',()=>{ console.log(JSON.stringify({type:'result',subtype:'success',text,args:process.argv.slice(2),worker:process.env.GH_TOKEN,orchestrator:process.env.OPENCODE_SERVER_PASSWORD})); setInterval(()=>{},1000); });
`,
    { mode: 0o755 }
  );
  const identity = await processes.launch({
    args: ["-p", "--session-id", "fake-id"],
    cwd: root,
    env: { PATH: bin, GH_TOKEN: "fake-worker-token" },
    prompt: "$(touch OWNED)\nTask data",
    log,
  });
  try {
    expect(processes.alive(identity)).toBe(true);
    expect(processes.alive({ ...identity, born: "not-this-process" })).toBe(false);
    processes.stop({ ...identity, born: "not-this-process" });
    expect(processes.alive(identity)).toBe(true);
    for (let i = 0; i < 100 && (!existsSync(log) || !readFileSync(log, "utf8").trim()); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const result = JSON.parse(readFileSync(log, "utf8"));
    expect(result).toEqual({
      type: "result",
      subtype: "success",
      text: "$(touch OWNED)\nTask data",
      args: ["-p", "--session-id", "fake-id"],
      worker: "fake-worker-token",
    });
    expect(result.args.join(" ")).not.toContain("fake-worker-token");
    expect(existsSync(join(root, "OWNED"))).toBe(false);
  } finally {
    processes.stop(identity);
  }
  for (let i = 0; i < 100 && processes.alive(identity); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(processes.alive(identity)).toBe(false);
}, 5000);
