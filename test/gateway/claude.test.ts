import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { processes } from "../../src/gateway/claude.js";
import { fixture } from "../helpers.js";

test.each([1, 2, 3])(
  "native headless runtime uses stdin/env, guards reused PIDs and stops its group (cold run %i)",
  async () => {
    // Cold Node-backed fake measured at 72/78/75 ms in the parallel full suite.
    // Budget 1.5s per startup/stop phase and 5s per test, not a global increase.
    // Optional timing records use the suite's format.
    const start = performance.now();
    const phaseBudget = 1500;
    async function until(description: string, ready: () => boolean) {
      const phaseStart = performance.now();
      while (!ready()) {
        const elapsed = performance.now() - phaseStart;
        if (elapsed >= phaseBudget) {
          throw new Error(
            `Child claude -p --session-id fake-id ${description} timed out after ${Math.round(elapsed)} ms (budget ${phaseBudget} ms)`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    const root = fixture();
    const bin = join(root, "bin");
    mkdirSync(bin);
    const log = join(root, "claude.log");
    writeFileSync(
      join(bin, "claude"),
      `#!${process.execPath}
let text=''; process.stdin.setEncoding('utf8');
setTimeout(()=>process.exit(124),4000).unref();
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
      await until("startup", () => existsSync(log) && Boolean(readFileSync(log, "utf8").trim()));
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
      if (process.env.VMETHOD_TEST_TIMINGS) {
        appendFileSync(
          process.env.VMETHOD_TEST_TIMINGS,
          JSON.stringify({
            test: expect.getState().currentTestName,
            file: "claude (Node fake)",
            args: ["-p", "--session-id", "fake-id"],
            duration: performance.now() - start,
          }) + "\n"
        );
      }
    }
    await until("stop", () => !processes.alive(identity));
    expect(processes.alive(identity)).toBe(false);
  },
  5000
);
