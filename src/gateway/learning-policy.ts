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

/** Learning submissions only add flat JSONL/Markdown files in their authorized project directories. */
export function learningPaths(
  people: readonly Person[],
  actor: unknown,
  repo: string,
  files: readonly { filename: string; previous_filename?: string; status: string }[]
): void {
  learningAuthor(people, actor, repo);
  const [owner, name] = repo.toLowerCase().split("/");
  const allowed = (path: string) => {
    const log = `learnings/models/${owner}-${name}/`;
    const notes = `learnings/notes/${name}/`;
    return (
      (path.startsWith(log) && /^[a-z0-9][a-z0-9-]*\.jsonl$/.test(path.slice(log.length))) ||
      (path.startsWith(notes) && /^[a-z0-9][a-z0-9-]*\.md$/.test(path.slice(notes.length)))
    );
  };
  if (
    !files.length ||
    files.some(
      (file) =>
        file.status !== "added" || !allowed(file.filename) || file.previous_filename !== undefined
    )
  ) {
    throw new Error(
      "Learning PR may only add new files in its authorized project log and notes directories"
    );
  }
}
