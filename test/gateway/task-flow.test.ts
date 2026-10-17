import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parse } from "graphql";
import { TaskFlow, conformingTitle } from "../../src/gateway/task-flow.js";
import { GitHubClient, type Dependencies } from "../../src/gateway/client.js";
import { getConfig } from "../../src/config.js";
import { object, type ObjectData } from "../../src/gateway/people.js";
import type { Card } from "../../src/board/types.js";
import { validProject } from "../helpers.js";
import { people, sha } from "./helpers.js";

const baseSha = "b".repeat(40),
  mergedSha = "c".repeat(40);
function fixture() {
  const root = validProject();
  const configPath = join(root, "vmethod.yaml");
  writeFileSync(
    configPath,
    readFileSync(configPath, "utf8").replace("/replace/with/consumer/checkout", root)
  );
  const config = getConfig(root, {});
  const events: string[] = [];
  const writes: { path: string; body: ObjectData }[] = [];
  let approved: boolean | "unknown" = true,
    issueApproved: boolean | "unknown" = true;
  let worker: "live" | "stopped" | "unknown" = "stopped";
  let fail = "",
    currentHead = sha,
    title = "feat: task";
  let prState = "OPEN",
    actualBase = "dev",
    branch = "8-task";
  let body = '<!-- vmethod-task {"issues":[8]} -->';
  let checks = [
    {
      id: 1,
      name: "check",
      app: { id: 909 },
      status: "completed",
      conclusion: "success",
      head_sha: sha,
    },
  ];
  let dirty = false,
    changed = true,
    issueClosed = false,
    branchExists = true,
    checkoutHead = sha;
  const comments: ObjectData[] = [];
  const cards: Card[] = [];
  const touched: { id: string; field: string; value: unknown; progress?: unknown }[] = [];
  const unexpected: string[] = [];
  const deps: Dependencies = {
    fetch: async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://api.github.com");
      const method = init?.method ?? "GET",
        path = url.pathname + url.search;
      const payload = init?.body ? object(JSON.parse(String(init.body))) : {};
      events.push(`${method} ${path}`);
      writes.push({ path, body: payload });
      if (fail && path.includes(fail)) {
        throw new Error("injected failure");
      }
      let data: unknown;
      if (method === "POST" && path === "/graphql") {
        parse(String(payload.query));
        data = { data: {} };
      } else if (method === "GET" && path.includes("/check-runs?")) {
        data = { check_runs: checks };
      } else if (method === "PUT" && path === "/repos/example/project/pulls/27/merge") {
        expect(payload.sha).toBe(sha);
        prState = "MERGED";
        data = { merged: true };
      } else if (method === "POST" && path === "/repos/example/project/pulls") {
        data = { number: 27, node_id: "pr" };
      } else if (
        method === "POST" &&
        /^\/repos\/example\/project\/issues\/(8|27)\/comments$/.test(path)
      ) {
        data = {};
      } else if (method === "POST" && path === "/repos/example/project/issues/27/labels") {
        data = {};
      } else if (method === "GET" && /^\/repos\/example\/project\/issues\/(8|27)$/.test(path)) {
        data = { assignees: [] };
      } else if (method === "POST" && path === "/repos/example/project/issues/27/assignees") {
        data = {};
      } else if (method === "PATCH" && path === "/repos/example/project/issues/8") {
        issueClosed = true;
        data = {};
      } else if (
        method === "GET" &&
        path === "/repos/example/project/issues/8/dependencies/blocking?per_page=100&page=1"
      ) {
        data = [
          {
            number: 9,
            state: "open",
            repository_url: "https://api.github.com/repos/example/project",
          },
          {
            number: 44,
            state: "open",
            repository_url: "https://api.github.com/repos/example/foreign",
          },
        ];
      } else if (
        method === "GET" &&
        path.startsWith("/repos/example/project/git/matching-refs/heads/")
      ) {
        data = branchExists ? [{ ref: `refs/heads/${branch}` }] : [];
      } else if (method === "DELETE" && path.startsWith("/repos/example/project/git/refs/heads/")) {
        branchExists = false;
        data = {};
      } else {
        unexpected.push(`${method} ${path}`);
        throw new Error(`Unexpected request ${method} ${path}`);
      }
      return new Response(JSON.stringify(data), { status: 200 });
    },
    exec: async (file, args, options) => {
      const command = `${file} ${args.join(" ")}`;
      events.push(command);
      if (file === "sh" && args[0] === "-c" && args[1] === "npm ci") {
        expect(options?.env).not.toHaveProperty("EXAMPLE_GITHUB_TOKEN");
        expect(options?.env?.HUSKY).toBe("0");
        if (fail === "install") {
          throw new Error("install failed");
        }
        return "";
      }
      if (file !== "git") {
        unexpected.push(command);
        throw new Error(`Unexpected ${command}`);
      }
      if (args.includes("fetch") || args.includes("push")) {
        return "";
      }
      if (args[0] === "commit-tree") {
        return sha;
      }
      if (args[0] === "merge-base" && args[1] === "--is-ancestor") {
        if (fail === "base") {
          throw new Error("base moved");
        }
        return "";
      }
      if (args.join(" ") === "rev-parse --abbrev-ref HEAD") {
        return "dev";
      }
      if (args.join(" ") === "status --porcelain") {
        return dirty ? " M package-lock.json" : "";
      }
      if (args.join(" ") === "rev-parse HEAD") {
        return checkoutHead;
      }
      if (args.join(" ") === "rev-parse refs/remotes/origin/dev") {
        return mergedSha;
      }
      if (args[0] === "merge" && args[1] === "--ff-only") {
        checkoutHead = String(args[2]);
        return "";
      }
      if (args[0] === "diff" && args[1] === "--name-only") {
        return changed ? "package-lock.json" : "";
      }
      unexpected.push(command);
      throw new Error(`Unexpected ${command}`);
    },
    now: () => 0,
    sleep: async () => {
      throw new Error("Unexpected retry/sleep");
    },
    report: (message) => {
      events.push(`report ${message}`);
    },
    workers: {
      status: async () => {
        events.push("worker-status");
        return worker;
      },
      resume: async () => {
        events.push("worker-resume");
      },
    },
  };
  const env = { EXAMPLE_GITHUB_TOKEN: "secret", XDG_STATE_HOME: join(root, "state") };
  const host: ConstructorParameters<typeof TaskFlow>[4] = {
    people,
    github: new GitHubClient({ ...config, gateway: { maxRetries: 0 } }, env, deps),
    board: () => ({
      ensure: async (id) => {
        events.push(`board-add ${id}`);
        return id;
      },
      set: async (input) => {
        if (fail === "board" && input.value === "Done") {
          throw new Error("board failed");
        }
        touched.push({ id: input.itemId, ...input });
        events.push(`board ${input.itemId} ${input.field} ${String(input.value)}`);
        return "ok";
      },
      capDone: async () => {
        events.push("done-cap");
      },
      snapshot: async () => ({ id: "board", readme: "", fields: [] }),
      cards: async () => cards,
    }),
    thread: async (ref, kind) => {
      events.push(`read ${kind} ${ref}`);
      if (kind === "issue" && ref === "8") {
        return {
          id: "issue",
          title,
          body,
          state: issueClosed ? "CLOSED" : "OPEN",
          labels: { nodes: [] },
        };
      }
      if (kind !== "pr" || ref !== "27") {
        throw new Error(`Unexpected thread ${kind} ${ref}`);
      }
      return {
        id: "pr",
        headRefOid: currentHead,
        baseRefOid: baseSha,
        headRefName: branch,
        baseRefName: actualBase,
        title,
        body,
        state: prState,
        mergeable: "MERGEABLE",
        isDraft: true,
        headRepository: { nameWithOwner: "example/project" },
        labels: { nodes: [] },
      };
    },
    comments: async () => comments,
    approved: async () => approved,
    candidates: async () => [],
    issueApproved: async () => issueApproved,
  };
  return {
    root,
    config,
    events,
    writes,
    touched,
    host,
    deps,
    env,
    comments,
    flow: () => new TaskFlow(root, env, config, deps, host),
    set: (values: {
      approved?: boolean | "unknown";
      issueApproved?: boolean;
      worker?: typeof worker;
      fail?: string;
      head?: string;
      title?: string;
      state?: string;
      base?: string;
      branch?: string;
      body?: string;
      dirty?: boolean;
      changed?: boolean;
    }) => {
      approved = values.approved ?? approved;
      issueApproved = values.issueApproved ?? issueApproved;
      worker = values.worker ?? worker;
      fail = values.fail ?? fail;
      currentHead = values.head ?? currentHead;
      title = values.title ?? title;
      prState = values.state ?? prState;
      actualBase = values.base ?? actualBase;
      branch = values.branch ?? branch;
      body = values.body ?? body;
      dirty = values.dirty ?? dirty;
      changed = values.changed ?? changed;
    },
    red: () => {
      checks = checks.map((c) => ({ ...c, conclusion: "failure" }));
    },
    done: () => expect(unexpected).toEqual([]),
  };
}

test.each(["unapproved", "gated", "handoff"])(
  "open-task refuses %s before mutation",
  async (reason) => {
    const f = fixture();
    if (reason === "unapproved") {
      f.set({ issueApproved: false });
    }
    if (reason === "handoff") {
      f.set({ body: "## Handoff breakpoints\n\nReview then format" });
    }
    await expect(
      f.flow().open({ issue: "8", model: reason === "gated" ? "astra" : "sol" })
    ).rejects.toThrow(
      reason === "unapproved" ? "Approved" : reason === "gated" ? "--owner-approved" : "expensive"
    );
    expect(f.writes).toEqual([]);
    f.done();
  }
);

test("open-task creates a draft, links without closing syntax, clears issue Progress and never estimates PRs", async () => {
  const f = fixture();
  f.set({ body: "## Approved spec\n\nImplement the test." });
  await expect(f.flow().open({ issue: "8", model: "sol", hold: true })).resolves.toContain(
    "draft PR #27"
  );
  const create = f.writes.find((w) => w.path.endsWith("/pulls"))!;
  expect(create.body).toMatchObject({ draft: true, base: "dev", title: "feat: task" });
  expect(create.body.body).toContain("https://github.com/example/project/issues/8");
  expect(create.body.body).not.toMatch(/(?:closes|part of)\s+#8/i);
  expect(create.body.body).not.toContain("<specifics>");
  expect(f.touched).toContainEqual(
    expect.objectContaining({ id: "pr", field: "Status", value: "In progress", progress: "⛔" })
  );
  expect(f.touched).toContainEqual(
    expect.objectContaining({ id: "issue", field: "Status", progress: null })
  );
  expect(f.touched.some((write) => write.field === "Estimate")).toBe(false);
  f.done();
});

test("expensive breakpoints tell workers to HANDOFF and end turn; unapproved exception is posted", async () => {
  const f = fixture();
  f.set({ body: "## Handoff breakpoints\n\nAfter implementation.", issueApproved: false });
  await f
    .flow()
    .open({ issue: "8", model: "astra", ownerApproved: true, unapproved: "Reproducer attached" });
  expect(f.writes.find((w) => w.path.endsWith("/pulls"))!.body.body).toContain(
    "then end your turn"
  );
  expect(f.writes.find((w) => w.path.endsWith("/8/comments"))!.body.body).toContain(
    "Reproducer attached"
  );
  f.done();
});

test.each(["owner", "changes", "answer", "ask", "approve"] as const)(
  "review %s posts protocol and maintains next actor",
  async (outcome) => {
    const f = fixture();
    const file = join(f.root, "review.md");
    writeFileSync(file, "Review evidence.");
    f.comments.push({ body: "[orchestrator] REVIEW round 2" });
    await f.flow().review({
      ref: "27",
      outcome,
      file,
      replyTo: "https://github.com/example/project/pull/27#issuecomment-1",
    });
    const comment = String(f.writes.find((w) => w.path.endsWith("/comments"))!.body.body);
    expect(comment).toContain("in reply to https://github.com/");
    if (outcome === "owner") {
      expect(comment).toContain(sha);
      expect(
        f.writes.some((w) => String(w.body.query).includes("markPullRequestReadyForReview"))
      ).toBe(true);
      expect(f.touched).toContainEqual(
        expect.objectContaining({ field: "Status", value: "In review", progress: "👤🔍" })
      );
      expect(f.writes.some((w) => w.path.endsWith("/assignees"))).toBe(true);
    }
    if (outcome === "changes") {
      expect(comment).toContain("REVIEW round 3");
      expect(f.touched).toContainEqual(expect.objectContaining({ progress: "🤖🔨 🔁3️⃣" }));
    }
    f.done();
  }
);

test.each(["approval", "stale", "red", "base", "worker", "unknown", "title"])(
  "merge refusal: %s",
  async (refusal) => {
    const f = fixture();
    if (["approval", "stale"].includes(refusal)) {
      f.set({ approved: false, ...(refusal === "stale" ? { head: "d".repeat(40) } : {}) });
    }
    if (refusal === "red") {
      f.red();
    }
    if (refusal === "base") {
      f.set({ fail: "base" });
    }
    if (refusal === "worker") {
      f.set({ worker: "live" });
    }
    if (refusal === "unknown") {
      delete f.deps.workers;
    }
    if (refusal === "title") {
      f.set({ title: "feat(scope): rejected" });
    }
    await expect(f.flow().merge("27")).rejects.toThrow();
    expect(f.writes.some((w) => w.path.endsWith("/merge"))).toBe(false);
    f.done();
  }
);

test("squash merges frozen head; board and archive precede fast-forward and install is last", async () => {
  const f = fixture();
  await f.flow().merge("27");
  expect(f.writes.find((w) => w.path.endsWith("/merge"))!.body).toMatchObject({
    sha,
    merge_method: "squash",
    commit_title: "feat: task (#27)",
  });
  expect(f.events.at(-1)).toBe("sh -c npm ci");
  expect(f.events.indexOf("done-cap")).toBeLessThan(
    f.events.findIndex((event) => event.startsWith("git merge --ff-only"))
  );
  expect(f.events).toContain("report revise estimates: #9");
  expect(f.touched.some((write) => write.id === "issue" && write.value === "Done")).toBe(true);
  f.done();
});

test.each(["track/topic", "pack/topic"])(
  "integration base %s leaves issues and main alone",
  async (base) => {
    const f = fixture();
    f.set({ base });
    await f.flow().merge("27");
    expect(f.events.some((event) => event.includes("--ff-only") || event.startsWith("sh "))).toBe(
      false
    );
    expect(f.touched.some((write) => write.id === "issue")).toBe(false);
    f.done();
  }
);

test("pack head requires merge commit and is kept", async () => {
  const f = fixture();
  f.set({ branch: "pack/batch" });
  await expect(f.flow().merge("27")).rejects.toThrow("--merge-commit");
  await f.flow().merge("27", true);
  expect(f.writes.find((w) => w.path.endsWith("/merge"))!.body.merge_method).toBe("merge");
  expect(f.writes.some((w) => w.path.includes("/git/refs"))).toBe(false);
  f.done();
});

test("requireCurrentBase false allows conflict-free green-head squash on moved base", async () => {
  const f = fixture();
  f.set({ fail: "base" });
  f.config.merge = { requireCurrentBase: false };
  await f.flow().merge("27");
  expect(f.events.some((event) => event.includes("merge-base --is-ancestor"))).toBe(false);
  f.done();
});

test("partial board failure resumes without repeating merge or issue closure", async () => {
  const f = fixture();
  f.set({ fail: "board" });
  await expect(f.flow().merge("27")).rejects.toThrow("board failed");
  f.set({ fail: "" });
  await f.flow().merge("27");
  expect(f.writes.filter((w) => w.path.endsWith("/merge"))).toHaveLength(1);
  expect(
    f.writes.filter((w) => w.path.endsWith("/issues/8") && w.body.state === "closed")
  ).toHaveLength(1);
  f.done();
});

test("failed install resumes with original trigger delta even though checkout already fast-forwarded", async () => {
  const f = fixture();
  f.set({ fail: "install" });
  await expect(f.flow().merge("27")).rejects.toThrow("install failed");
  f.set({ fail: "" });
  await f.flow().merge("27");
  expect(f.events.filter((event) => event === "sh -c npm ci")).toHaveLength(2);
  expect(f.events.filter((event) => event.startsWith("git merge --ff-only"))).toHaveLength(1);
  expect(f.events.at(-1)).toBe("sh -c npm ci");
  f.done();
});

test("button merge with bad historical title and only Closes header still finishes legacy follow-up", async () => {
  const f = fixture();
  f.set({ state: "MERGED", title: "Old task title", body: "Closes #8\n\nLegacy prompt." });
  await f.flow().merge("27");
  expect(f.events.some((event) => event.includes("warning: already-merged"))).toBe(true);
  expect(f.events.some((event) => event.includes("legacy link"))).toBe(true);
  expect(f.touched.some((write) => write.id === "issue" && write.value === "Done")).toBe(true);
  expect(f.writes.some((w) => w.path.endsWith("/merge"))).toBe(false);
  f.done();
});

test("unchanged lockfile avoids install; release-hold posts GO, clears hold and resumes", async () => {
  const f = fixture();
  f.set({ changed: false });
  await f.flow().merge("27");
  expect(f.events.some((event) => event.startsWith("sh "))).toBe(false);
  f.set({ state: "OPEN" });
  await f.flow().release("27");
  expect(f.writes.some((w) => String(w.body.body).startsWith("[orchestrator] GO"))).toBe(true);
  expect(f.events.at(-1)).toBe("worker-resume");
  f.done();
});

test.each(["feat: normal", "BREAKING CHANGE: interface", "fix: $(hostile); `data`"])(
  "conforming title %s",
  (title) => expect(conformingTitle(title)).toBe(true)
);
test.each(["feat(scope): invalid", "feat: ", "feat: hi\nnew line", "plain title"])(
  "nonconforming title %s",
  (title) => expect(conformingTitle(title)).toBe(false)
);
