import { expect, test } from "vitest";
import { fixtureServer, graph, item } from "./helpers.js";
import recorded from "../fixtures/github/diagnostic-pulls-open.json" with { type: "json" };

// Project the recorded REST PR shape onto the fixture repository/identity/branch.
const candidate = {
  ...recorded[0],
  number: 65,
  state: "open",
  user: { login: "worker", id: 102, type: "User" },
  head: { ...recorded[0].head, ref: "64-task", repo: { full_name: "example/project" } },
};
const listPath = "/repos/example/project/pulls?state=open&head=example%3A64-task&per_page=100";
const meta = item({
  state: "OPEN",
  headRefName: "64-task",
  headRepository: { nameWithOwner: "example/project" },
});

test.each([
  "# Task: fix: a task (issue #64)",
  '<!-- vmethod-task {"issues":[64]} -->',
  '<!-- vmethod-task {"issues":[]} -->',
  '<!-- vmethod-task {"part":true,"issues":[64]} -->',
])("resolveTask returns the PR number, not a branch number: %s", async (body) => {
  const f = fixtureServer([
    { path: listPath, method: "GET", json: [candidate] },
    graph({ repository: { pullRequest: meta } }),
    graph({ node: { ...meta, body } }),
  ]);
  expect(await f.gateway.call("resolveTask", { branch: "64-task" }, { role: "worker" })).toBe(65);
  f.done();
});

test.each(
  [
    [],
    [candidate, candidate],
    [{ ...candidate, state: "closed" }],
    [{ ...candidate, user: { login: "stranger", id: 999, type: "User" } }],
    [{ ...candidate, head: { ...candidate.head, ref: "different" } }],
    [{ ...candidate, head: { ...candidate.head, repo: { full_name: "other/fork" } } }],
  ].map((json) => ({ json }))
)(
  "resolveTask refuses absent, ambiguous, foreign or unaccepted candidates: %j",
  async ({ json }) => {
    const f = fixtureServer([{ path: listPath, method: "GET", json }]);
    expect(
      await f.gateway.call("resolveTask", { branch: "64-task" }, { role: "worker" })
    ).toBeNull();
    f.done();
  }
);

test.each([
  { body: "Not a task" },
  { body: '<!-- vmethod-task {"issues":[64,]} -->' },
  {
    body: '<!-- vmethod-task {"issues":[64]} -->',
    editor: { login: "stranger", databaseId: 999, __typename: "User" },
    lastEditedAt: "2026-10-17T17:34:00Z",
  },
  { body: "# Task: task (issue #64)", headRefName: "moved" },
  { body: "# Task: task (issue #64)", state: "CLOSED" },
])("resolveTask rechecks current body and metadata: %j", async (changes) => {
  const f = fixtureServer([
    { path: listPath, method: "GET", json: [candidate] },
    graph({ repository: { pullRequest: meta } }),
    graph({ node: { ...meta, ...changes } }),
  ]);
  expect(await f.gateway.call("resolveTask", { branch: "64-task" }, { role: "worker" })).toBeNull();
  f.done();
});
