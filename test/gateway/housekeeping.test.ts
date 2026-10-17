import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { actor, fixtureServer, graph, item } from "./helpers.js";
import { gatewayVerb } from "../../src/cli/gateway.js";
import issueResponse from "../fixtures/github/issue-response.json" with { type: "json" };
import boardRecording from "../fixtures/github/board-write-inputs.json" with { type: "json" };

const acceptedIssue = () =>
  item({
    state: "OPEN",
    title: "Issue",
    body: "Specification",
    labels: { nodes: [], pageInfo: { hasNextPage: false } },
  });

test("issue create sends validated file content and repeated labels to the configured repository", async () => {
  const f = fixtureServer([
    {
      path: "/repos/example/project/issues",
      body: { title: "A title", body: "A body\n", labels: ["bug", "task"] },
      json: { number: issueResponse.number, node_id: issueResponse.node_id },
    },
  ]);
  const file = join(f.root, "body.md");
  writeFileSync(file, "A body\n");
  expect(
    await gatewayVerb(
      f.transport,
      "issue",
      ["create", "A title", file, "--label", "bug", "--label", "task"],
      { VMETHOD_ROLE: "orchestrator" }
    )
  ).toBe("Created issue #37");
  f.done();
}, 15000);

test.each([
  ["Estimate", "NaN", "finite numeric"],
  ["Estimate", "1e999", "finite numeric"],
  ["Status", "Missing option", "Unknown Status option"],
  ["Progress", "text", "single-select or number"],
  ["Missing", "1", "single-select or number"],
])(
  "board set rejects %s=%s before mutation",
  async (field, value, message) => {
    const reads = boardReads();
    if (["Progress", "Missing"].includes(field)) {
      reads.pop();
    }
    const contentId = boardRecording.items.nodes[0].content.id;
    const f = fixtureServer([
      graph({ repository: { issue: item({ id: contentId }) } }),
      graph({ node: { ...acceptedIssue(), id: contentId } }),
      ...reads,
    ]);
    await expect(f.transport.call("boardSetIssue", { ref: "39", field, value })).rejects.toThrow(
      message
    );
    f.done();
  },
  15000
);

test.each(["missing", "foreign", "PR"])(
  "board set refuses %s card without writing",
  async (reason) => {
    const recorded = structuredClone(boardRecording);
    const reads = boardReads(recorded);
    if (reason === "missing") {
      recorded.items.nodes = [];
    } else if (reason === "foreign") {
      recorded.items.nodes[0].content.repository.nameWithOwner = "example/foreign";
    } else {
      recorded.items.nodes[0].content.__typename = "PullRequest";
    }
    const contentId = boardRecording.items.nodes[0].content.id;
    const f = fixtureServer([
      graph({ repository: { issue: item({ id: contentId }) } }),
      graph({ node: { ...acceptedIssue(), id: contentId } }),
      ...reads,
    ]);
    await expect(
      f.transport.call("boardSetIssue", { ref: "39", field: "Estimate", value: "5" })
    ).rejects.toThrow(reason === "foreign" ? "foreign repository" : "not on configured board");
    f.done();
  },
  15000
);

test.each([
  ["issue", ["create", "Title", "file", "--label"]],
  ["issue", ["close", "37", "--comment"]],
  ["issue", ["close", "37", "--wrong", "file"]],
  ["board", ["set", "39", "Estimate"]],
  ["board", ["set", "39", "Estimate", "5", "--repo", "foreign"]],
])(
  "housekeeping CLI rejects malformed %s arguments %j without networking",
  async (verb, args) => {
    const f = fixtureServer([]);
    await expect(
      gatewayVerb(f.transport, verb, args, { VMETHOD_ROLE: "orchestrator" })
    ).rejects.toThrow("Usage");
    f.done();
  },
  15000
);

test("issue close gates identity and posts the exact checked comment before closing", async () => {
  const f = fixtureServer([
    graph({ repository: { issue: item() } }),
    graph({ node: acceptedIssue() }),
    {
      path: "/repos/example/project/issues/37/comments",
      body: { body: "Reason for closure\n" },
      json: { id: 1 },
    },
    {
      path: "/repos/example/project/issues/37",
      method: "PATCH",
      body: { state: "closed", state_reason: "completed" },
      json: issueResponse,
    },
  ]);
  const file = join(f.root, "comment.md");
  writeFileSync(file, "Reason for closure\n");
  expect(
    await gatewayVerb(f.transport, "issue", ["close", "37", "--comment", file], {
      VMETHOD_ROLE: "orchestrator",
    })
  ).toBe("Closed issue #37");
  f.done();
}, 15000);

test.each(["issueCreate", "issueClose", "boardSetIssue"] as const)(
  "%s denies workers before any network",
  async (operation) => {
    const f = fixtureServer([]);
    const inputs = {
      issueCreate: { title: "Title", file: "missing" },
      issueClose: { ref: "37" },
      boardSetIssue: { ref: "37", field: "Estimate", value: "5" },
    };
    await expect(
      f.transport.call(operation, inputs[operation], { role: "worker", taskPr: 40 })
    ).rejects.toThrow("denied");
    f.done();
  },
  15000
);

test.each(["issueClose", "boardSetIssue"] as const)(
  "%s rejects foreign references before networking",
  async (operation) => {
    const f = fixtureServer([]);
    await expect(
      f.transport.call(operation, { ref: "example/foreign#37", field: "Estimate", value: "5" })
    ).rejects.toThrow("configured repository");
    f.done();
  },
  15000
);

test.each(["issueClose", "boardSetIssue"] as const)(
  "%s filters unknown issue authors before requesting text",
  async (operation) => {
    const f = fixtureServer([
      graph({ repository: { issue: item({ author: { ...actor(), databaseId: 999 } }) } }),
    ]);
    await expect(
      f.transport.call(operation, { ref: "37", field: "Estimate", value: "5" })
    ).rejects.toThrow("accepted task thread");
    f.done();
  },
  15000
);

test.each(["issueCreate", "issueClose"] as const)(
  "%s refuses unsafe Markdown before mutations",
  async (operation) => {
    const f = fixtureServer([]);
    const file = join(f.root, "bad.md");
    writeFileSync(file, "Fixes #37\n");
    await expect(
      f.transport.call(operation, { ref: "37", title: "Title", file, comment: file })
    ).rejects.toThrow();
    f.done();
  },
  15000
);

function boardReads(recording = structuredClone(boardRecording)) {
  // Only repository scope is renamed to the offline test project's configured repository.
  recording.items.nodes[0].content.repository.nameWithOwner = "example/project";
  return [
    {
      path: "/graphql",
      json: {
        data: { organization: { projectV2: { id: recording.id, readme: recording.readme } } },
      },
    },
    { path: "/graphql", json: { data: { node: { fields: recording.fields } } } },
    { path: "/graphql", json: { data: { node: { items: recording.items } } } },
  ];
}

test("board mutation failure never records a completed Status move", async () => {
  const contentId = boardRecording.items.nodes[0].content.id;
  const f = fixtureServer([
    graph({ repository: { issue: item({ id: contentId }) } }),
    graph({ node: { ...acceptedIssue(), id: contentId } }),
    ...boardReads(),
    { path: "/graphql", json: { errors: [{ message: "write refused" }] } },
  ]);
  await expect(
    f.transport.call("boardSetIssue", { ref: "39", field: "Status", value: "Done" })
  ).rejects.toThrow("write refused");
  expect(() =>
    readFileSync(
      join(
        f.env.XDG_STATE_HOME,
        "vmethod",
        "example-state",
        "board",
        boardRecording.items.nodes[0].id
      )
    )
  ).toThrow();
  f.done();
}, 15000);

test("issue create reports failure without retrying a non-idempotent write", async () => {
  const f = fixtureServer([
    { path: "/repos/example/project/issues", status: 500, json: { message: "failed" } },
  ]);
  const file = join(f.root, "body.md");
  writeFileSync(file, "Body");
  await expect(f.transport.call("issueCreate", { title: "Title", file })).rejects.toThrow();
  expect(f.sleeps).toEqual([]);
  f.done();
}, 15000);

test.each(["Estimate", "Status"])(
  "board set %s decodes recordings, writes exact values and records Status moves",
  async (field) => {
    const card = boardRecording.items.nodes[0];
    const value = field === "Estimate" ? "2.5" : "Done";
    const progressId = boardRecording.fields.nodes.find((f) => f.name === "Progress")!.id;
    const fieldId = boardRecording.fields.nodes.find((f) => f.name === field)!.id;
    const f = fixtureServer([
      graph({ repository: { issue: item({ id: card.content.id }) } }),
      graph({ node: { ...acceptedIssue(), id: card.content.id } }),
      ...boardReads(),
      {
        path: "/graphql",
        checkQuery(query, variables) {
          expect(query).toContain("mutation BoardSetCards");
          const update = {
            projectId: boardRecording.id,
            itemId: card.id,
            fieldId,
            value: field === "Estimate" ? { number: 2.5 } : { singleSelectOptionId: "e807513c" },
          };
          expect(variables).toEqual(
            field === "Status"
              ? {
                  m0: { projectId: boardRecording.id, itemId: card.id, fieldId: progressId },
                  m1: update,
                }
              : { m0: update }
          );
        },
        json: {
          data: {
            m0: { projectV2Item: { id: card.id } },
            ...(field === "Status" ? { m1: { projectV2Item: { id: card.id } } } : {}),
          },
        },
      },
    ]);
    await expect(
      gatewayVerb(f.transport, "board", ["set", "39", field, value], {
        VMETHOD_ROLE: "orchestrator",
      })
    ).resolves.toBe("Board field updated");
    if (field === "Status") {
      const path = join(f.env.XDG_STATE_HOME, "vmethod", "example-state", "board");
      expect(readFileSync(join(path, card.id), "utf8")).toContain("Done");
    }
    f.done();
  },
  15000
);
