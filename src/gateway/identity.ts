import { getConfig, loadYaml } from "../config.js";
import { GitHubClient, type Dependencies } from "./client.js";
import { Digest } from "./digest.js";
import { PeopleFilter, object, type Person, type ObjectData } from "./people.js";

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

/** Report the gh login's identity in GH_CONFIG_DIR against VMETHOD_ROLE, never printing the token. */
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
  const expected = env.VMETHOD_ROLE;
  try {
    const client = new GitHubClient(config, env, deps);
    const person = tokenIdentity(await tokenViewer(client), filter);
    // The orchestrator role is per repository (#186): a login qualifies only
    // when it belongs to this configuration's own repository's orchestrator.
    const role = filter.roleIn(person, String(config.repo));
    const messages = [`GH_CONFIG_DIR: ${person.login} (${role})`];
    if (expected ? role !== expected : role !== "orchestrator" && role !== "worker") {
      messages.push(
        `GH_CONFIG_DIR must hold ${expected ? `a${expected === "orchestrator" ? "n" : ""} ${expected}` : "an orchestrator or worker"} identity${expected ? " (VMETHOD_ROLE)" : ""}`
      );
      return { code: 1, messages };
    }
    return { code: 0, messages };
  } catch (error) {
    return { code: 1, messages: [`GH_CONFIG_DIR: ${(error as Error).message}`] };
  }
}
