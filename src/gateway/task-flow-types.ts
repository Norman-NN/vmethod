export interface OpenTaskInput {
  issue?: string;
  direct?: string;
  unapproved?: string;
  hold?: boolean;
  model?: string;
  ownerApproved?: boolean;
}
export interface ReviewInput {
  ref: string;
  outcome: "changes" | "owner" | "answer" | "ask" | "approve";
  file: string;
  replyTo?: string;
}
