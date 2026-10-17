import { expect, test } from "vitest";
import { learningAuthor, learningPaths } from "../../src/gateway/learning-policy.js";
import type { Person } from "../../src/gateway/people.js";

// REST user identity projection: id/login/type, not GraphQL databaseId/__typename.
const actor = { id: 343394568, login: "vimescmd", type: "User" };
const people: Person[] = [
  { ...actor, type: "User", role: "orchestrator", repos: ["vworlds/vmethod"] },
];

test("learning authorization pins numeric identity, login, type, role and project", () => {
  expect(learningAuthor(people, actor, "vworlds/vmethod")).toBe(people[0]);
  expect(learningAuthor(people, { ...actor, login: "VIMESCMD" }, "VWORLDS/VMETHOD")).toBe(
    people[0]
  );
  for (const change of [{ id: 1 }, { login: "outsider" }, { type: "Bot" }]) {
    expect(() => learningAuthor(people, { ...actor, ...change }, "vworlds/vmethod")).toThrow(
      "binding"
    );
  }
  for (const person of [
    { ...people[0], role: "worker" as const },
    { ...people[0], role: "owner" as const },
    { ...people[0], repos: undefined },
    { ...people[0], repos: ["vworlds/vecs"] },
  ]) {
    expect(() => learningAuthor([person], actor, "vworlds/vmethod")).toThrow("binding");
  }
  expect(() => learningAuthor(people, actor, "vworlds/vecs")).toThrow("binding");
}, 15000);

test("learning paths reject cross-project edits, traversal, deletion and renames", () => {
  const file = {
    filename: "learnings/models/vworlds-vmethod/14-16-abcdef012345.jsonl",
    status: "added",
  };
  expect(() =>
    learningPaths(people, actor, "vworlds/vmethod", [
      file,
      { filename: "learnings/notes/vmethod/2026-10-17-abcdef012345.md", status: "added" },
    ])
  ).not.toThrow();
  for (const files of [
    [],
    [{ ...file, status: "modified" }],
    [{ filename: "learnings/models/vworlds-vmethod.jsonl", status: "modified" }],
    [{ filename: "learnings/models/vworlds-vmethod.jsonl", status: "added" }],
    [{ ...file, filename: "learnings/models/vworlds-vecs/14-16-abcdef012345.jsonl" }],
    [{ ...file, filename: "learnings/models/vworlds-vmethod/../other.jsonl" }],
    [{ ...file, filename: "learnings/notes/vecs/2026-10-17-abcdef012345.md" }],
    [{ filename: "learnings/notes/vmethod/2026-10-17-abcdef012345.md", status: "modified" }],
    [{ ...file, filename: "learnings/models/vworlds-vecs.jsonl" }],
    [{ ...file, filename: "learnings/models/../vworlds-vmethod.jsonl" }],
    [{ ...file, filename: ".github/workflows/ci.yml" }],
    [{ ...file, status: "removed" }],
    [{ ...file, status: "renamed", previous_filename: "people.yaml" }],
    [{ ...file, previous_filename: "people.yaml" }],
  ]) {
    expect(() => learningPaths(people, actor, "vworlds/vmethod", files)).toThrow("only add");
  }
  expect(() => learningPaths(people, { ...actor, id: 1 }, "vworlds/vmethod", [file])).toThrow(
    "binding"
  );
}, 15000);
