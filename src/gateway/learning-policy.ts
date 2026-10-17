import { object, type Person } from "./people.js";

/** Shared submission/CI authorization; only the central registry grants project access. */
export function learningAuthor(people: readonly Person[], actor: unknown, repo: string): Person {
  const value = object(actor);
  const person = people.find(
    (entry) =>
      entry.id === value.id &&
      entry.type === value.type &&
      typeof value.login === "string" &&
      entry.login.toLowerCase() === value.login.toLowerCase()
  );
  if (
    !person ||
    person.role !== "orchestrator" ||
    !person.repos?.some((allowed) => allowed.toLowerCase() === repo.toLowerCase())
  ) {
    throw new Error("Learning submission requires a central orchestrator project binding");
  }
  return person;
}

/** Validate every changed path, including rename sources, against a single authorized project. */
export function learningPaths(
  people: readonly Person[],
  actor: unknown,
  repo: string,
  files: readonly { filename: string; previous_filename?: string; status: string }[]
): void {
  learningAuthor(people, actor, repo);
  const [owner, name] = repo.toLowerCase().split("/");
  const allowed = new Set([
    `learnings/models/${owner}-${name}.jsonl`,
    `learnings/notes/${name}.md`,
  ]);
  if (
    !files.length ||
    files.some(
      (file) =>
        !["added", "modified"].includes(file.status) ||
        !allowed.has(file.filename) ||
        file.previous_filename !== undefined
    )
  ) {
    throw new Error("Learning PR may only add or modify its authorized project log and notes");
  }
}
