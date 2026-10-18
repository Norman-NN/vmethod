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

/** Decode only vmethod's structured relation, never prose or GitHub closing links. */
export function taskRelation(body: string): { issues: number[]; part: boolean } | undefined {
  const header = /^# Task: [^\r\n]* \((part of )?issue #([1-9]\d*)\)[\t ]*(?:\r?\n|$)/.exec(body);
  if (header) {
    const issue = Number(header[2]);
    if (!Number.isSafeInteger(issue)) {
      throw new Error("Invalid task header issue");
    }
    return { issues: [issue], part: Boolean(header[1]) };
  }
  const marker = /<!-- vmethod-task (\{[^\n]*\}) -->/.exec(body);
  if (!marker) {
    return undefined;
  }
  const relation = JSON.parse(marker[1]);
  if (relation.part !== undefined && typeof relation.part !== "boolean") {
    throw new Error("Invalid partial task relation");
  }
  if (
    !Array.isArray(relation.issues) ||
    relation.issues.some((n: unknown) => !Number.isSafeInteger(n) || Number(n) < 1)
  ) {
    throw new Error("Invalid task issue relation");
  }
  return { issues: [...new Set<number>(relation.issues)], part: relation.part === true };
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
