import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { stringify } from "yaml";
import { checkOnline } from "../../src/gateway/identity.js";
import { fixtureServer, actor, people, fakeServer } from "./helpers.js";

test.each([
  [actor(2), "orchestrator", 0, "peer (orchestrator)"],
  [actor(1), "worker", 0, "worker (worker)"],
  [actor(1), "orchestrator", 1, "worker (worker)"],
  [actor(2), "worker", 1, "peer (orchestrator)"],
  [actor(1), undefined, 0, "worker (worker)"],
  [actor(3), undefined, 1, "github-actions[bot] (system)"],
] as const)(
  "online check reports the GH_CONFIG_DIR login and verifies it against VMETHOD_ROLE",
  async (viewer, role, code, line) => {
    const f = fixtureServer([]);
    writeFileSync(join(f.root, "people.yaml"), stringify(people));
    const fake = fakeServer([
      {
        path: "/graphql",
        query: "query GatewayIdentity { viewer { databaseId login __typename } }",
        json: { data: { viewer } },
      },
    ]);
    const tokens: unknown[] = [];
    const result = await checkOnline(
      f.root,
      { ...f.env, GH_TOKEN: "ignored-token", ...(role ? { VMETHOD_ROLE: role } : {}) },
      {
        ...f.deps,
        fetch: async (url, init) => {
          tokens.push((init?.headers as Record<string, string>).authorization);
          return fake.fetch(url, init);
        },
      }
    );
    expect(result.code).toBe(code);
    expect(result.messages[0]).toBe(`GH_CONFIG_DIR: ${line}`);
    expect(tokens).toEqual(["Bearer fake-token"]);
    expect(result.messages.join("\n")).not.toContain("fake-token");
    fake.done();
    f.done();
  },
  15000
);
