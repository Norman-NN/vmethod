import { getConfig, loadYaml } from "../config.js";
import { GitHubClient, type Dependencies } from "./client.js";
import { Digest } from "./digest.js";
import { PeopleFilter, object, type Person, type ObjectData } from "./people.js";

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

/** Read only the non-secret credential identity; callers may cache this promise. */
export async function tokenViewer(client: GitHubClient): Promise<ObjectData> {
  return object(
    object(await client.graphql("query GatewayIdentity { viewer { databaseId login __typename } }"))
      .viewer
  );
}

/** Match token pins strictly; only the gated Actions learning path permits its recorded User viewer. */
export function tokenIdentity(
  viewer: ObjectData,
  filter: PeopleFilter,
  actionsLearningCheck = false
): Person {
  const person =
    filter.identity(viewer, false) ??
    (actionsLearningCheck && viewer.__typename === "User"
      ? filter.people.find(
          (person) =>
            person.role === "system" &&
            person.type === "Bot" &&
            person.id === viewer.databaseId &&
            person.login === viewer.login
        )
      : undefined);
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
      const person = tokenIdentity(await tokenViewer(client), filter);
      // The orchestrator role is per repository (#186): a credential qualifies only
      // when it belongs to this configuration's own repository's orchestrator.
      const role = filter.roleIn(person, String(config.repo));
      messages.push(`credentials.${key}: ${person.login} (${role})`);
      if (role !== expected) {
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
