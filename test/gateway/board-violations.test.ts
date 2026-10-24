import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { object, type ObjectData } from "../../src/gateway/people.js";
import { WatchFake } from "./watch-fake.js";
import { sha } from "./helpers.js";

/**
 * Replays each multi-field verb's ordered write sequence through the watcher's board
 * violation check (issue #199). Every row mirrors one journal row plus the board or
 * assignment effect the real verb produces; the scripted gateway tests and the flow
 * order probes assert these exact write orders against the verbs. Boundary k polls
 * the watcher with GitHub holding write k's effect and its journal prefix, so a read
 * between the verb's own writes must stay quiet. The last poll ages the operation
 * record out and proves the finished state alone is flag-free.
 *
 * Pre-states are valid resting states (a progress state that names a role always
 * rests with that role's account assigned), so a flagged intermediate can only be
 * created by the verb's own writes.
 */
interface ReplayRow {
  kind: string;
  number: number;
  op?: string;
  field?: string;
  value?: string | number | null;
  itemId?: string;
  commentId?: number;
}

interface ReplayCase {
  before: (f: WatchFake) => void;
  cards: ReplayCard[];
  rows: ReplayRow[];
}

interface ReplayCard {
  number: number;
  status: string;
  progress: string;
  /** Issues default; only delivery PRs need the override. */
  kind?: "Issue" | "PullRequest";
  assignees: string[];
  state?: "OPEN" | "CLOSED" | "MERGED";
  /** Created-card case: the issue joins the board only at its membership add. */
  absent?: boolean;
}

const AT = "2026-10-17T10:00:00.000Z";

/** Fold one journal row into the fake board state, as GitHub applied it. */
function folder(f: WatchFake, absent: Map<number, ReplayCard>): (row: ReplayRow) => void {
  return (row) => {
    let card = f.cards.find((entry) => Number(object(entry.content).number) === row.number);
    if (!card) {
      if (row.kind === "addProjectV2ItemById") {
        if (!absent.has(row.number)) {
          throw new Error(`Unmapped board addition for #${row.number}`);
        }
        const definition = absent.get(row.number)!;
        card = f.card(definition.number, "Scoping", "Issue");
        object(card.progress).text = definition.progress;
        object(card.content).assignees = {
          nodes: definition.assignees.map((login) => ({ login })),
        };
        absent.delete(row.number);
        f.cards.push(card);
        return;
      }
      if (
        ["operation", "comment", "created", "closed", "merged"].includes(row.kind) ||
        row.kind.startsWith("PATCH")
      ) {
        return;
      }
      throw new Error(`Unmapped row for #${row.number}: ${row.kind}`);
    }
    const content = object(card.content);
    if (row.kind === "closed" || row.kind === "merged") {
      content.state = row.kind === "closed" ? "CLOSED" : "MERGED";
      return;
    }
    if (
      ["comment", "created", "convertPullRequestToDraft", "markPullRequestReadyForReview"].includes(
        row.kind
      ) ||
      row.kind.startsWith("PATCH")
    ) {
      return;
    }
    if (row.kind === "assigned" || row.kind === "unassigned") {
      const nodes = (object(content.assignees).nodes as ObjectData[]).map((entry) =>
        String(entry.login)
      );
      const next =
        row.kind === "assigned"
          ? [...new Set([...nodes, String(row.value)])]
          : nodes.filter((login) => login.toLowerCase() !== String(row.value).toLowerCase());
      content.assignees = { nodes: next.map((login) => ({ login })) };
      return;
    }
    if (row.kind === "board" && row.field) {
      if (row.field === "Status") {
        object(card.status).name = String(row.value ?? "");
      } else if (row.field === "Progress") {
        object(card.progress).text = row.value === null ? "" : String(row.value);
      } else if (row.field === "Estimate") {
        card.estimate = { number: row.value };
      }
    }
  };
}

const opRow = (number: number, op: string): ReplayRow => ({ kind: "operation", number, op });
const commentRow = (number: number): ReplayRow => ({
  kind: "comment",
  number,
  commentId: 6242861295,
});
const assignRow = (kind: "assigned" | "unassigned", number: number, login: string): ReplayRow => ({
  kind,
  number,
  field: "Assignee",
  value: login,
});
const boardRow = (number: number, field: string, value: string | number | null): ReplayRow => ({
  kind: "board",
  number,
  field,
  value,
  itemId: `PVTI_${number}`,
});
const flipRow = (
  kind: "convertPullRequestToDraft" | "markPullRequestReadyForReview",
  number: number
): ReplayRow => ({ kind, number });
const closedRow = (number: number): ReplayRow => ({ kind: "closed", number });
const createdRow = (number: number): ReplayRow => ({ kind: "created", number });
const addRow = (number: number): ReplayRow => ({
  kind: "addProjectV2ItemById",
  number,
  itemId: `PVTI_${number}`,
});
const mergedRow = (number: number): ReplayRow => ({ kind: "merged", number });
const patchRow = (
  kind: "PATCH issues/24" | "PATCH issues/8" | "PATCH pulls/24",
  number: number
): ReplayRow => ({ kind, number });

async function replay(label: string, prepare: (f: WatchFake) => ReplayCase): Promise<void> {
  const f = new WatchFake();
  try {
    const { before, cards, rows } = prepare(f);
    before(f);
    const absent = new Map(
      cards
        .filter((replayCard) => replayCard.absent)
        .map((replayCard) => [replayCard.number, replayCard])
    );
    f.cards = cards
      .filter((replayCard) => !replayCard.absent)
      .map((replayCard) => {
        const card = f.card(replayCard.number, replayCard.status, replayCard.kind);
        object(card.status).name = replayCard.status;
        object(card.progress).text = replayCard.progress;
        object(card.content).assignees = {
          nodes: replayCard.assignees.map((login) => ({ login })),
        };
        if (replayCard.state) {
          object(card.content).state = replayCard.state;
        }
        return card;
      });
    mkdirSync(f.dir, { recursive: true });
    const apply = folder(f, absent);
    const loop = f.loop();
    const violations = async (): Promise<string[]> =>
      (await f.once(loop))
        .filter((event) => event.kind === "board-violation")
        .map((event) => event.line);
    for (let index = 0; index <= rows.length; index += 1) {
      if (index > 0) {
        apply(rows[index - 1]);
      }
      writeFileSync(
        join(f.dir, "writes.jsonl"),
        rows
          .slice(0, index)
          .map((row) => `${JSON.stringify({ at: AT, repo: "example/project", ...row })}\n`)
          .join("")
      );
      expect(await violations(), `${label} at write boundary ${index}`).toEqual([]);
    }
    // Age the operation record out: the finished state must be flag-free on its own.
    f.advance(121_000);
    expect(await violations(), `${label} after the operation aged out`).toEqual([]);
  } finally {
    f.done();
  }
}

const taskPull = (number: number, issue: number, body: string) => ({
  number,
  title: "feat: task",
  head: { ref: `${issue}-watch`, sha },
  base: { ref: "dev" },
  created_at: "2026-10-17T09:59:00.000Z",
  user: { login: "worker", id: 102, type: "User" },
  body,
});

const delivery =
  (issue: number): ((f: WatchFake) => void) =>
  (f) => {
    f.pulls = [taskPull(24, issue, `<!-- vmethod-task {"issues":[${issue}]} -->`)];
    f.issues = [
      { number: issue, labels: [] },
      { number: 24, pull_request: {}, body: "", labels: [] },
    ];
  };

const noCards = (f: WatchFake): void => {
  f.pulls = [];
  f.issues = [];
};

/** TaskFlow.review's write sequence for one outcome, PR card first, linked issue after. */
function reviewCase(outcome: "changes" | "owner" | "answer" | "ask" | "approve") {
  const card: ReplayCard = {
    number: 24,
    status: outcome === "answer" ? "Owner review" : "Executing",
    // The orchestrator holds the turn: verified 🧭🔍 or the repaired worker READY.
    progress: outcome === "answer" ? "👤🔍" : "🧭🔍",
    kind: "PullRequest",
    assignees: outcome === "answer" ? ["owner"] : ["peer"],
  };
  const turn: ReplayRow[] =
    outcome === "answer"
      ? [assignRow("unassigned", 24, "owner")]
      : outcome === "approve"
        ? [] // the turn already sits with the orchestrator; no assignment writes
        : [
            assignRow("unassigned", 24, "peer"),
            ...(outcome === "owner" || outcome === "ask"
              ? [assignRow("assigned", 24, "owner")]
              : []),
          ];
  const board: [string, string] =
    outcome === "changes" || outcome === "answer"
      ? ["🤖🔨", "Executing"]
      : outcome === "owner"
        ? ["👤🔍", "Owner review"]
        : outcome === "ask"
          ? ["👤❓", "Executing"]
          : ["🧭🔍", "Approved"];
  const flip: "convertPullRequestToDraft" | "markPullRequestReadyForReview" =
    outcome === "changes" || outcome === "answer" || outcome === "ask"
      ? "convertPullRequestToDraft"
      : "markPullRequestReadyForReview";
  const rows: ReplayRow[] = [
    opRow(24, "review"),
    opRow(6, "review"),
    commentRow(24),
    flipRow(flip, 24),
    ...turn,
    boardRow(24, "Progress", board[0]),
    boardRow(24, "Status", board[1]),
    // The linked issue's no-op turn write never journals; only its board move does.
    boardRow(6, "Progress", null),
    boardRow(6, "Status", "Executing"),
  ];
  return { card, rows };
}

test.each(["changes", "owner", "answer", "ask", "approve"] as const)(
  "review %s: no poll between its writes reports a violation",
  async (outcome) => {
    const { card, rows } = reviewCase(outcome);
    await replay(`review ${outcome}`, () => ({
      before: delivery(6),
      cards: [
        card,
        { number: 6, status: "Executing", progress: "", kind: "Issue", assignees: ["worker"] },
      ],
      rows,
    }));
  }
);

test.each([
  {
    label: "first scope review",
    pre: { number: 39, status: "Scoping", progress: "", assignees: [] },
    turn: [assignRow("assigned", 39, "owner")],
  },
  {
    label: "rescope",
    pre: { number: 39, status: "Spec review", progress: "🧭🔍", assignees: ["peer"] },
    turn: [assignRow("unassigned", 39, "peer"), assignRow("assigned", 39, "owner")],
  },
])(
  "scope-review ($label): no poll between its writes reports a violation",
  async ({ pre, turn }) => {
    const card: ReplayCard = { ...pre, kind: "Issue" };
    await replay(`scope-review ${card.status}`, () => ({
      before: noCards,
      cards: [card],
      // ServerFlow.scopeReview: journal the operation, hand the turn to the owner, post
      // the summary, then the ordered board handoff (progress companion before Status).
      rows: [
        opRow(39, "scope-review"),
        ...turn,
        commentRow(39),
        boardRow(39, "Progress", "👤🔍"),
        boardRow(39, "Status", "Spec review"),
      ],
    }));
  }
);

test.each([
  {
    label: "Executing summons",
    pre: { number: 8, status: "Executing", progress: "🤖🔨", assignees: ["worker"] },
    turn: [assignRow("unassigned", 8, "worker"), assignRow("assigned", 8, "owner")],
  },
  {
    label: "Scoping question",
    pre: { number: 8, status: "Scoping", progress: "", assignees: [] },
    turn: [assignRow("assigned", 8, "owner")],
  },
])("issue ask ($label): no poll between its writes reports a violation", async ({ pre, turn }) => {
  await replay(`ask from ${pre.status}`, () => ({
    before: noCards,
    cards: [{ ...pre, kind: "Issue" }],
    // TaskFlow.ask: journal the operation, post the owner question, assign the owner,
    // then the ordered board move (the issue keeps its own Status).
    rows: [
      opRow(8, "ask"),
      commentRow(8),
      ...turn,
      boardRow(8, "Progress", "👤❓"),
      boardRow(8, "Status", pre.status),
    ],
  }));
});

test("issue edit and its paired scope-review stay quiet at every boundary", async () => {
  await replay("issue edit plus scope-review", () => ({
    before: noCards,
    cards: [{ number: 8, status: "Executing", progress: "", kind: "Issue", assignees: ["worker"] }],
    rows: [
      opRow(8, "issue edit"),
      patchRow("PATCH issues/8", 8),
      opRow(8, "scope-review"),
      assignRow("unassigned", 8, "worker"),
      assignRow("assigned", 8, "owner"),
      commentRow(8),
      boardRow(8, "Progress", "👤🔍"),
      boardRow(8, "Status", "Spec review"),
    ],
  }));
});

test("issue create's board init writes stay quiet at every boundary", async () => {
  await replay("issue create", () => ({
    before: noCards,
    cards: [
      { number: 37, status: "Scoping", progress: "", kind: "Issue", assignees: [], absent: true },
    ],
    rows: [
      createdRow(37),
      opRow(37, "issue create"),
      addRow(37),
      boardRow(37, "Estimate", 5),
      boardRow(37, "Progress", null),
      boardRow(37, "Status", "Scoping"),
    ],
  }));
});

test("merge-task follow-up writes stay quiet at every boundary", async () => {
  await replay("merge-task", () => ({
    before: (f: WatchFake): void => {
      // The merge already happened: the PR left the open pull listing.
      f.pulls = [];
      f.issues = [{ number: 6, labels: [] }];
    },
    cards: [
      {
        number: 24,
        status: "Approved",
        progress: "🧭🔍",
        kind: "PullRequest",
        assignees: ["peer"],
      },
      { number: 6, status: "Executing", progress: "", kind: "Issue", assignees: ["worker"] },
    ],
    // TaskFlow.merge's follow-up: the merge, one operation record for the PR and its
    // issue, then per issue the closure and ordered board move, then the PR card.
    rows: [
      mergedRow(24),
      opRow(24, "merge-task"),
      opRow(6, "merge-task"),
      closedRow(6),
      boardRow(6, "Progress", null),
      boardRow(6, "Status", "Done"),
      boardRow(24, "Progress", null),
      boardRow(24, "Status", "Done"),
      assignRow("unassigned", 24, "peer"),
    ],
  }));
});

test.each(["owner", "worker", "none"])(
  "release-hold from a %s turn stays quiet between its writes",
  async (holder) => {
    await replay(`release-hold from ${holder}`, () => ({
      before: (fake: WatchFake): void => {
        fake.pulls = [
          taskPull(
            24,
            6,
            '> ⛔ ON HOLD. Wait for [orchestrator] GO.\n\n<!-- vmethod-task {"issues":[6]} -->'
          ),
        ];
        fake.issues = [
          { number: 6, labels: [] },
          { number: 24, pull_request: {}, body: "", labels: [] },
        ];
      },
      cards: [
        {
          number: 24,
          status: "Executing",
          progress: "⛔",
          kind: "PullRequest",
          // A held card never rests with a management turn; the none variant is the
          // typical hold, the owner variant exercises the reorder's turn clear first.
          assignees: holder === "none" ? ["worker"] : [holder],
        },
      ],
      // TaskFlow.release: the title/body patch, one operation record, the GO comment,
      // then the #199 order: the turn write lands before the board move.
      rows: [
        patchRow("PATCH pulls/24", 24),
        opRow(24, "release-hold"),
        commentRow(24),
        ...(holder === "none" ? [] : [assignRow("unassigned", 24, holder)]),
        boardRow(24, "Progress", "🤖🔨"),
        boardRow(24, "Status", "Executing"),
      ],
    }));
  }
);
