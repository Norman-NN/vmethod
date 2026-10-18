import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { backfillCosts } from "../../src/gateway/cost-backfill.js";
import capture from "../..//.tmp/captures/opencode/session.json" with { type: "json" };

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

test("prices recorded worker sessions using the recorded OpenCode session shape", async () => {
  const root = mkdtempSync(join(tmpdir(), "vmethod-cost-"));
  roots.push(root);
  const workers = join(root, "state/vmethod/test/workers");
  mkdirSync(workers, { recursive: true });
  writeFileSync(
    join(workers, "41.json"),
    JSON.stringify({
      pr: 41,
      repo: "vworlds/vmethod",
      id: "ses_capture",
      model: { kind: "opencode", family: "sol" },
    })
  );
  const setCost = vi.fn(async (pr: number, value: string) => void [pr, value]);
  const result = await backfillCosts({
    root,
    config: { repo: "vworlds/vmethod", stateName: "test" },
    env: { XDG_STATE_HOME: join(root, "state") },
    models: [
      {
        family: "sol",
        model: "codexbal/gpt-6.1-sol",
        price: { input: 2, output: 10, cached: 0.1 },
      },
    ],
    readSession: async () => (capture as { body: { data: unknown } }).body.data,
    setCost,
  });
  expect(result).toContain("#41: $");
  expect(setCost).toHaveBeenCalledOnce();
  expect(setCost.mock.calls[0][0]).toBe(41);
});

test("dry-run reports unknown sessions without writing", async () => {
  const root = mkdtempSync(join(tmpdir(), "vmethod-cost-"));
  roots.push(root);
  const workers = join(root, "state/vmethod/test/workers");
  mkdirSync(workers, { recursive: true });
  writeFileSync(
    join(workers, "42.json"),
    JSON.stringify({
      pr: 42,
      repo: "vworlds/vmethod",
      id: "ses_gone",
      model: { kind: "opencode", family: "sol" },
    })
  );
  const setCost = vi.fn(async (pr: number, value: string) => void [pr, value]);
  const result = await backfillCosts(
    {
      root,
      config: { repo: "vworlds/vmethod", stateName: "test" },
      env: { XDG_STATE_HOME: join(root, "state") },
      models: [],
      readSession: async () => undefined,
      setCost,
    },
    { dryRun: true }
  );
  expect(result).toContain("#42: unknown");
  expect(setCost).not.toHaveBeenCalled();
});
