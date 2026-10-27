import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { stringify } from "yaml";
import { gatewayVerb } from "../../src/cli/gateway.js";
import { taskFlowVerb } from "../../src/cli/task-flow.js";
import { createGateway } from "../../src/gateway/server.js";
import { actor, fakeServer, people } from "./helpers.js";
import type { Person } from "../../src/gateway/people.js";
import actionsViewer from "../fixtures/github/actions-viewer.json" with { type: "json" };
import { validProject, ghConfig } from "../helpers.js";

function fixture(viewer: unknown, env: NodeJS.ProcessEnv = {}, pins: Person[] = people) {
  const root = validProject();
  writeFileSync(join(root, "people.yaml"), stringify(pins));
  const fake = fakeServer([
    {
      path: "/graphql",
      query: "query GatewayIdentity { viewer { databaseId login __typename } }",
      json: { data: { viewer } },
    },
  ]);
  const gateway = createGateway(
    root,
    { GH_CONFIG_DIR: ghConfig("fake-token"), XDG_STATE_HOME: join(root, "state"), ...env },
    {
      fetch: fake.fetch,
      exec: async () => {
        throw new Error("Unexpected exec");
      },
      now: () => 0,
      sleep: async () => {
        throw new Error("Unexpected sleep");
      },
      report: () => {
        throw new Error("Unexpected report");
      },
    }
  );
  return { root, gateway, done: fake.done };
}

test.each([
  ["board", ["set", "3", "Status", "Done"]],
  ["issue", ["create", "Title", "nonexistent.md"]],
  ["open-task", ["3"]],
] as const)(
  "worker credential cannot claim orchestrator for %s",
  async (verb, args) => {
    const f = fixture(actor(1));
    const run = verb === "open-task" ? taskFlowVerb : gatewayVerb;
    await expect(run(f.gateway, verb, [...args], { VMETHOD_ROLE: "orchestrator" })).rejects.toThrow(
      "VMETHOD_ROLE=orchestrator refused: token belongs to worker (worker)"
    );
    f.done();
  },
  15000
);

test.each([
  { ...actor(1), databaseId: 999 },
  { ...actor(1), login: "impostor" },
  { ...actor(1), __typename: "Bot" },
  actor(3),
  null,
])(
  "unlisted, mismatched and system viewers are refused: %j",
  async (viewer) => {
    const f = fixture(viewer);
    await expect(f.gateway.call("watchMutes", {}, { role: "orchestrator" })).rejects.toThrow(
      "token"
    );
    await expect(f.gateway.call("watchMutes", {}, { role: "orchestrator" })).rejects.toThrow(
      "token"
    );
    f.done();
  },
  15000
);

test.each([
  [
    { login: "unknown", databaseId: 999, __typename: "User" },
    "login=unknown databaseId=999 type=User",
  ],
  [
    { login: "github-actions", __typename: "Bot" },
    "login=github-actions databaseId=<missing> type=Bot",
  ],
  [
    { login: "github-actions", databaseId: null, __typename: "Bot" },
    "login=github-actions databaseId=<missing> type=Bot",
  ],
  [{ databaseId: 999 }, "login=<missing> databaseId=999 type=<missing>"],
  [null, "login=<missing> databaseId=<missing> type=<missing>"],
  [{}, "login=<missing> databaseId=<missing> type=<missing>"],
] as const)(
  "unpinned viewer refusal reports only identity fields: %j",
  async (viewer, fields) => {
    const f = fixture(viewer);
    await expect(f.gateway.call("watchMutes", {}, { role: "orchestrator" })).rejects.toThrow(
      `Gateway token refused: identity is not pinned in people.yaml: ${fields}`
    );
    f.done();
  },
  15000
);

test("orchestrator may narrow to worker without a task; viewer is cached across concurrent calls", async () => {
  const f = fixture(actor(2));
  const ctx = { role: "worker" } as const;
  mkdirSync(join(f.root, "learnings/models"), { recursive: true });
  writeFileSync(join(f.root, "learnings/models/empty.jsonl"), "");
  const calls = await Promise.all([
    f.gateway.call("learnings", { action: "report", json: true }, ctx),
    f.gateway.call("learnings", { action: "report", json: true }, ctx),
  ]);
  for (const call of calls) {
    expect(JSON.parse(call)).toMatchObject({ byFamily: {}, byKind: {} });
  }
  expect(await f.gateway.call("learnings", { action: "report", json: true }, ctx)).toBe(calls[0]);
  await expect(f.gateway.call("watchMutes", {}, ctx)).rejects.toThrow("denied for client role");
  f.done();
}, 15000);

test.each([undefined, "false", "true"])(
  "system identities cannot set boards or create issues even in Actions (%s)",
  async (GITHUB_ACTIONS) => {
    const f = fixture(actor(3), { GITHUB_ACTIONS });
    for (const [verb, args] of [
      ["board", ["set", "3", "Status", "Done"]],
      ["issue", ["create", "Title", "nonexistent.md"]],
    ] as const) {
      await expect(
        gatewayVerb(f.gateway, verb, [...args], { VMETHOD_ROLE: "orchestrator" })
      ).rejects.toThrow(
        "Gateway token refused: github-actions[bot] (system) is not an orchestrator or worker identity"
      );
    }
    f.done();
  },
  15000
);

test.each([undefined, "false", "TRUE"])(
  "learningCheck refuses system credentials outside Actions (%s)",
  async (GITHUB_ACTIONS) => {
    const f = fixture(actor(3), { GITHUB_ACTIONS });
    await expect(
      f.gateway.call("learningCheck", { ref: "47" }, { role: "worker" })
    ).rejects.toThrow(
      "Gateway token refused: github-actions[bot] (system) is not an orchestrator or worker identity"
    );
    f.done();
  },
  15000
);

test.each([
  { ...actor(3), databaseId: 999 },
  { ...actor(3), login: "impostor[bot]" },
  { ...actor(3), __typename: "Organization" },
])(
  "Actions flag cannot authenticate an unpinned system viewer: %j",
  async (viewer) => {
    const f = fixture(viewer, { GITHUB_ACTIONS: "true" });
    await expect(
      f.gateway.call("learningCheck", { ref: "47" }, { role: "worker" })
    ).rejects.toThrow("Gateway token refused: identity is not pinned");
    f.done();
  },
  15000
);

test("Actions exception does not authorize a system credential in a worker task context", async () => {
  const f = fixture(actor(3), { GITHUB_ACTIONS: "true" });
  await expect(
    f.gateway.call("learningCheck", { ref: "47" }, { role: "worker", taskPr: 47 })
  ).rejects.toThrow("Gateway token refused: github-actions[bot] (system)");
  f.done();
}, 15000);

test("Actions flag cannot grant a worker identity the system-only label exception", async () => {
  const f = fixture(actor(1), { GITHUB_ACTIONS: "true" });
  await expect(
    f.gateway.call("learningCheck", { ref: "47", label: true }, { role: "worker" })
  ).rejects.toThrow("Learning writes require orchestrator role");
  f.done();
}, 15000);

test.each([
  [actionsViewer, { GITHUB_ACTIONS: "false" }, "system", "Bot", undefined],
  [actionsViewer, { GITHUB_ACTIONS: "true" }, "system", "Bot", 47],
  [{ ...actionsViewer, databaseId: 999 }, { GITHUB_ACTIONS: "true" }, "system", "Bot", undefined],
  [
    { ...actionsViewer, login: "github-actions" },
    { GITHUB_ACTIONS: "true" },
    "system",
    "Bot",
    undefined,
  ],
  [
    { ...actionsViewer, login: "GITHUB-ACTIONS[BOT]" },
    { GITHUB_ACTIONS: "true" },
    "system",
    "Bot",
    undefined,
  ],
  [actionsViewer, { GITHUB_ACTIONS: "true" }, "worker", "Bot", undefined],
  [actionsViewer, { GITHUB_ACTIONS: "true" }, "orchestrator", "Bot", undefined],
] as const)(
  "CI viewer type exception never widens other identity pins: %j",
  async (viewer, env, role, type, taskPr) => {
    const pin: Person = {
      login: "github-actions[bot]",
      id: actionsViewer.databaseId,
      role,
      type,
      ...(role === "system" ? { appIds: [15368], events: ["check_run" as const] } : {}),
    };
    const f = fixture(viewer, env, [pin]);
    await expect(
      f.gateway.call("learningCheck", { ref: "47" }, { role: "worker", taskPr })
    ).rejects.toThrow("Gateway token refused");
    f.done();
  },
  15000
);

test("real Actions User viewer cannot call board or issue operations", async () => {
  const f = fixture(actionsViewer, { GITHUB_ACTIONS: "true" }, [
    {
      login: "github-actions[bot]",
      id: actionsViewer.databaseId,
      type: "Bot",
      role: "system",
      appIds: [15368],
      events: ["check_run"],
    },
  ]);
  await expect(
    f.gateway.call(
      "boardSetIssue",
      { ref: "3", field: "Status", value: "Done" },
      { role: "orchestrator" }
    )
  ).rejects.toThrow("Gateway token refused");
  await expect(
    f.gateway.call(
      "issueCreate",
      { title: "Title", file: "nonexistent.md" },
      { role: "orchestrator" }
    )
  ).rejects.toThrow("Gateway token refused");
  f.done();
}, 15000);

test("task-scoped sessions refuse orchestrator credentials", async () => {
  const f = fixture(actor(2));
  await expect(
    f.gateway.call("learnings", { action: "report" }, { role: "worker", taskPr: 3 })
  ).rejects.toThrow("worker session holds a non-worker token (peer); fix the worker environment");
  f.done();
}, 15000);

test("task-scoped sessions accept worker credentials and preserve own-task guards", async () => {
  const f = fixture(actor(1));
  const ctx = { role: "worker", taskPr: 3 } as const;
  mkdirSync(join(f.root, "learnings/models"), { recursive: true });
  writeFileSync(join(f.root, "learnings/models/empty.jsonl"), "");
  expect(
    JSON.parse(await f.gateway.call("learnings", { action: "report", json: true }, ctx))
  ).toMatchObject({ byFamily: {}, byKind: {} });
  await expect(f.gateway.call("post", { ref: "4", file: "nonexistent" }, ctx)).rejects.toThrow(
    "own taskPr"
  );
  f.done();
}, 15000);

test("a peer project's orchestrator token holds no gateway role for this repository", async () => {
  const viewer = { login: "vecsmaster", databaseId: 900, __typename: "User" };
  const f = fixture(viewer, {}, [
    ...people,
    { login: "vecsmaster", id: 900, type: "User", role: "orchestrator", repos: ["example/other"] },
  ]);
  await expect(
    f.gateway.call("read", { kind: "pr", ref: "3" }, { role: "orchestrator" })
  ).rejects.toThrow(
    "Gateway token refused: vecsmaster (collaborator) is not an orchestrator or worker identity"
  );
  f.done();
}, 15000);
