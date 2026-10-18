export interface OpenTaskInput {
  issue?: string;
  direct?: string;
  unapproved?: string;
  hold?: boolean;
  /** Requires issue; records a partial relation that merge follow-up must not complete. */
  part?: boolean;
  model?: string;
  ownerApproved?: boolean;
}
export interface ReviewInput {
  ref: string;
  outcome: "changes" | "owner" | "answer" | "ask" | "approve";
  file: string;
  replyTo?: string;
}

/** Recognize a task header or a valid structured task marker, including direct tasks. */
export function isTaskPrompt(body: string): boolean {
  return taskIssueNumbers(body) !== undefined;
}

/** Issue relations from a task header/marker; an empty list is a valid direct task. */
export function taskIssueNumbers(body: string): number[] | undefined {
  const header = /^# Task: [^\r\n]+ \((?:part of )?issue #([1-9]\d*)\)[\t ]*(?:\r?\n|$)/m.exec(
    body
  );
  const issues = header && Number.isSafeInteger(Number(header[1])) ? [Number(header[1])] : [];
  const marker = /<!-- vmethod-task (\{[^\r\n]*\}) -->/.exec(body);
  if (marker) {
    try {
      const value = JSON.parse(marker[1]);
      if (
        Array.isArray(value.issues) &&
        value.issues.every((n: unknown) => Number.isSafeInteger(n) && Number(n) > 0) &&
        (value.part === undefined || typeof value.part === "boolean")
      ) {
        return [...new Set<number>([...issues, ...value.issues])];
      }
    } catch {
      // A malformed marker is not a relation; a valid header still is.
    }
  }
  return issues.length ? issues : undefined;
}
