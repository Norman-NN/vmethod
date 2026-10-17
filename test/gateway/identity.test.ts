import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { stringify } from "yaml";
import { checkOnline } from "../../src/gateway/identity.js";
import { fixtureServer, actor, people, fakeServer } from "./helpers.js";

test.each([
  [actor(2), actor(1), 0],
  [actor(1), actor(2), 1],
  [actor(3), actor(1), 1],
  [{ ...actor(2), databaseId: 999 }, actor(1), 1],
] as const)(
  "online check reports and verifies both configured identities",
  async (orchestrator, worker, code) => {
    const f = fixtureServer([]);
    writeFileSync(join(f.root, "people.yaml"), stringify(people));
    const path = join(f.root, "vmethod.yaml");
    const original = readFileSync(path, "utf8");
    expect(original).toContain("EXAMPLE_WORKER_GITHUB_TOKEN");
    writeFileSync(path, original.replace("EXAMPLE_WORKER_GITHUB_TOKEN", "WORKER_TOKEN"));
    const fake = fakeServer(
      [orchestrator, worker].map((viewer) => ({
        path: "/graphql",
        query: "query GatewayIdentity { viewer { databaseId login __typename } }",
        json: { data: { viewer } },
      }))
    );
    const tokens: unknown[] = [];
    const result = await checkOnline(
      f.root,
      { ...f.env, WORKER_TOKEN: "worker-token" },
      {
        ...f.deps,
        fetch: async (url, init) => {
          tokens.push((init?.headers as Record<string, string>).authorization);
          return fake.fetch(url, init);
        },
      }
    );
    expect(result.code).toBe(code);
    expect(result.messages.join("\n")).toContain("credentials.githubToken:");
    const workerRole = people.find((person) => person.id === worker.databaseId)!.role;
    expect(result.messages).toContain(
      `credentials.workerGithubToken: ${worker.login} (${workerRole})`
    );
    expect(tokens).toEqual(["Bearer fake-token", "Bearer worker-token"]);
    expect(result.messages.join("\n")).not.toContain("fake-token");
    expect(result.messages.join("\n")).not.toContain("worker-token");
    fake.done();
    f.done();
  },
  15000
);
