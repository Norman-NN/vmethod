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
  if (/^# Task: [^\r\n]+ \((?:part of )?issue #[1-9]\d*\)[\t ]*(?:\r?\n|$)/m.test(body)) {
    return true;
  }
  const marker = /<!-- vmethod-task (\{[^\r\n]*\}) -->/.exec(body);
  if (!marker) {
    return false;
  }
  try {
    const value = JSON.parse(marker[1]);
    return (
      Array.isArray(value.issues) &&
      value.issues.every((n: unknown) => Number.isSafeInteger(n) && Number(n) > 0) &&
      (value.part === undefined || typeof value.part === "boolean")
    );
  } catch {
    return false;
  }
}
