import { object, type ObjectData, type PeopleFilter } from "./people.js";

export interface ApprovalPR {
  headRefOid: string;
  reviews: ObjectData[];
  timeline: ObjectData[];
  comments: ObjectData[];
  boardNumber: number;
  historical?: boolean;
}

export function isIssueOwnerApproved(
  timeline: ObjectData[],
  boardNumber: number,
  filter: PeopleFilter
): boolean | "unknown" {
  const events = timeline.filter(
    (event) =>
      event.__typename === "ProjectV2ItemStatusChangedEvent" &&
      object(event.project).number === boardNumber
  );
  if (!events.length) {
    return false;
  }
  if (events.some((event) => !Number.isFinite(Date.parse(String(event.createdAt))))) {
    return "unknown";
  }
  const latestAt = Math.max(...events.map((event) => Date.parse(String(event.createdAt))));
  const latest = events.filter((event) => Date.parse(String(event.createdAt)) === latestAt);
  if (latest.some((event) => event.status !== "Approved")) {
    return false;
  }
  if (latest.some((event) => event.actor == null)) {
    return "unknown";
  }
  return latest.every((event) => filter.identity(event.actor)?.role === "owner");
}

export function isOwnerApproved(pr: ApprovalPR, filter: PeopleFilter): boolean | "unknown" {
  if (!/^[a-f\d]{40}$/i.test(pr.headRefOid)) {
    return "unknown";
  }
  const owner = (actor: unknown) => filter.identity(actor)?.role === "owner";
  if (pr.historical) {
    const handovers = pr.comments.filter((comment) => {
      const author = filter.identity(comment.author);
      const editor = comment.lastEditedAt == null ? author : filter.identity(comment.editor);
      return (
        author?.role === "orchestrator" &&
        editor?.role === "orchestrator" &&
        typeof comment.body === "string" &&
        /^\[orchestrator\] OWNER REVIEW(?:\s|$)/.test(comment.body.split(/\r?\n/, 1)[0]) &&
        new RegExp(`(?<![a-zA-Z0-9])${pr.headRefOid}(?![a-zA-Z0-9])`, "i").test(comment.body)
      );
    });
    const handedAt = Math.max(
      ...handovers.map((comment) => Date.parse(String(comment.lastEditedAt ?? comment.createdAt)))
    );
    if (!Number.isFinite(handedAt)) {
      return "unknown";
    }
    const afterHandover = pr.timeline.filter(
      (event) =>
        event.__typename === "ProjectV2ItemStatusChangedEvent" &&
        event.field === "Status" &&
        object(event.project).number === pr.boardNumber &&
        Date.parse(String(event.createdAt)) > handedAt
    );
    const approvals = afterHandover.filter(
      (event) => event.status === "Approved" && owner(event.actor)
    );
    if (!approvals.length) {
      return false;
    }
    const approvalAt = Math.max(...approvals.map((event) => Date.parse(String(event.createdAt))));
    return !afterHandover.some(
      (event) =>
        Date.parse(String(event.createdAt)) > approvalAt &&
        owner(event.actor) &&
        event.status !== "Approved"
    );
  }
  if (
    pr.reviews.some(
      (review) =>
        review.state === "APPROVED" &&
        object(review.commit).oid === pr.headRefOid &&
        owner(review.author) &&
        (review.lastEditedAt == null || owner(review.editor))
    )
  ) {
    return true;
  }
  const events = pr.timeline.filter(
    (event) =>
      event.__typename === "ProjectV2ItemStatusChangedEvent" &&
      event.field === "Status" &&
      object(event.project).number === pr.boardNumber
  );
  if (!events.length) {
    return false;
  }
  // Unknown ordering must never allow an older approval to win.
  if (
    events.some(
      (event) =>
        typeof event.createdAt !== "string" || !Number.isFinite(Date.parse(event.createdAt))
    )
  ) {
    return "unknown";
  }
  const latestAt = Math.max(...events.map((event) => Date.parse(String(event.createdAt))));
  const latest = events.filter((event) => Date.parse(String(event.createdAt)) === latestAt);
  if (latest.some((event) => event.status !== "Approved")) {
    return false;
  }
  if (latest.some((event) => event.actor == null)) {
    return "unknown";
  }
  if (!latest.every((event) => owner(event.actor))) {
    return false;
  }

  const handovers = pr.comments.filter((comment) => {
    const author = filter.identity(comment.author);
    const editor = comment.lastEditedAt == null ? author : filter.identity(comment.editor);
    if (
      author?.role !== "orchestrator" ||
      editor?.role !== "orchestrator" ||
      typeof comment.body !== "string"
    ) {
      return false;
    }
    const firstLine = comment.body.split(/\r?\n/, 1)[0];
    if (!/^\[orchestrator\] OWNER REVIEW(?:\s|$)/.test(firstLine)) {
      return false;
    }
    return new RegExp(`(?<![a-zA-Z0-9])${pr.headRefOid}(?![a-zA-Z0-9])`, "i").test(comment.body);
  });
  // An edit naming the SHA must also precede approval: it cannot backdate a handover.
  const times = handovers.map((comment) =>
    Date.parse(String(comment.lastEditedAt ?? comment.createdAt))
  );
  if (times.some((time) => !Number.isFinite(time))) {
    return false;
  }
  return times.length > 0 && latestAt > Math.max(...times);
}
