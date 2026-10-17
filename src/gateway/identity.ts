import { getConfig, loadYaml } from "../config.js";
import { GitHubClient, type Dependencies } from "./client.js";
import { Digest } from "./digest.js";
import { PeopleFilter, object, type Person } from "./people.js";

/** Offline cross-file validation: Claude launches must have a separate worker credential. */
export function claudeCredentialFindings(root: string, env: NodeJS.ProcessEnv): string[] {
  const models = loadYaml(root, "models") as { kind: string }[];
  return models.some((model) => model.kind === "claude") &&
    !object(getConfig(root, env).credentials).workerGithubToken
    ? [
        "Claude model families require credentials.workerGithubToken naming a worker-scoped token environment variable",
      ]
    : [];
}

/** Authenticate the configured credential against all three owner-approved identity pins. */
export async function tokenIdentity(client: GitHubClient, filter: PeopleFilter): Promise<Person> {
  const viewer = object(
    object(await client.graphql("query GatewayIdentity { viewer { databaseId login __typename } }"))
      .viewer
  );
  const person = filter.identity(viewer);
  if (!person) {
    throw new Error(
      `Gateway token refused: identity is not pinned in people.yaml: login=${String(viewer.login ?? "<missing>")} databaseId=${String(viewer.databaseId ?? "<missing>")} type=${String(viewer.__typename ?? "<missing>")}`
    );
  }
  return person;
}

/** Report each configured GitHub credential independently, never printing credential values. */
export async function checkOnline(
  root: string,
  env: NodeJS.ProcessEnv,
  deps: Dependencies
): Promise<{ code: number; messages: string[] }> {
  const config = getConfig(root, env);
  const filter = new PeopleFilter(
    loadYaml(root, "people") as Person[],
    String(config.org),
    new Digest(env, String(config.stateName), deps.now)
  );
  const credentials = object(config.credentials);
  const messages: string[] = [];
  let code = 0;
  for (const [key, expected] of [
    ["githubToken", "orchestrator"],
    ["workerGithubToken", "worker"],
  ] as const) {
    const name = credentials[key];
    if (key === "workerGithubToken" && name === undefined) {
      continue;
    }
    try {
      const client = new GitHubClient({ ...config, credentials: { githubToken: name } }, env, deps);
      const person = await tokenIdentity(client, filter);
      messages.push(`credentials.${key}: ${person.login} (${person.role})`);
      if (person.role !== expected) {
        messages.push(
          `credentials.${key} must belong to an ${expected === "orchestrator" ? "orchestrator" : "worker"} identity`
        );
        code = 1;
      }
    } catch (error) {
      messages.push(`credentials.${key}: ${(error as Error).message}`);
      code = 1;
    }
  }
  return { code, messages };
}
