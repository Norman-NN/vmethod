import { expect, test } from "vitest";
import { actor, fixtureServer, graph, item, sha } from "./helpers.js";

test("link-task reaches the authenticated body-edit path as an orchestrator", async () => {
  const body = "# Task: feat: task (issue #8)\n\nYou are a worker.\nPrompt.";
  const f = fixtureServer([
    graph({ repository: { pullRequest: item() } }),
    graph({
      node: item({
        body,
        title: "feat: task",
        state: "OPEN",
        headRefName: "8-task",
        baseRefName: "dev",
        headRepository: { nameWithOwner: "example/project" },
        labels: { nodes: [], pageInfo: { hasNextPage: false } },
      }),
    }),
    {
      path: "/repos/example/project/pulls/27",
      method: "PATCH",
      body: { body: "# Task: feat: task (issue #8)\n\nCloses #8\n\nYou are a worker.\nPrompt." },
    },
  ]);
  await expect(f.transport.call("linkTask", { ref: "27" })).resolves.toBe("Linked task #27");
  f.done();
});

test("open-task checks the issue timeline actor at the server, not the card's Status", async () => {
  const f = fixtureServer([
    graph({ repository: { issue: item() } }),
    graph({
      node: item({
        body: "Approved specification",
        title: "feat: task",
        state: "OPEN",
        labels: { nodes: [], pageInfo: { hasNextPage: false } },
      }),
    }),
    graph({ node: item() }),
    graph({
      node: item({
        timelineItems: {
          nodes: [
            {
              __typename: "ProjectV2ItemStatusChangedEvent",
              actor: actor(2),
              status: "Approved",
              createdAt: "2026-01-01T00:00:00Z",
              project: { number: 1 },
            },
          ],
          pageInfo: { hasNextPage: false },
        },
      }),
    }),
  ]);
  await expect(f.transport.call("openTask", { issue: "8", model: "sol" })).rejects.toThrow(
    "Approved by an owner"
  );
  f.done();
});

test("worker status goes through accepted metadata and defaults to unknown, never stopped", async () => {
  const f = fixtureServer([
    graph({ repository: { pullRequest: item() } }),
    graph({
      node: item({
        body: "task",
        title: "feat: task",
        labels: { nodes: [], pageInfo: { hasNextPage: false } },
      }),
    }),
  ]);
  await expect(f.transport.call("workerStatus", { ref: "27" })).resolves.toBe("unknown");
  f.done();
});

test("merge is refused at the gateway when worker management reports live, without touching GitHub merge", async () => {
  const f = fixtureServer([
    graph({ repository: { pullRequest: item() } }),
    graph({
      node: item({
        body: "task",
        title: "feat: task",
        state: "OPEN",
        headRefName: "8-task",
        baseRefName: "dev",
        baseRefOid: sha,
        headRepository: { nameWithOwner: "example/project" },
        labels: { nodes: [], pageInfo: { hasNextPage: false } },
      }),
    }),
  ]);
  f.deps.workers = {
    status: async (pr) => {
      expect(pr).toBe(27);
      return "live";
    },
    resume: async () => {
      throw new Error("Unexpected resume");
    },
  };
  await expect(f.transport.call("mergeTask", { ref: "27" })).rejects.toThrow("Stop the worker");
  f.done();
});
