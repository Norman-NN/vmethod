# GitHub board field regression

`board-fields.json` is a minimal projection of the field shape reported by the
orchestrator's live vworlds/vmethod run in PR #24 review round 2. The creation-time
value (`2026-10-16T11:12:25Z`) and ISO string wire type come from that report.
The report did not include a full response recording: the connection envelope is
the queried GraphQL shape, and the field identifier is an offline placeholder.
Only the Progress field is retained to exercise snapshot decoding and writing.

Do not represent this as an unmodified full API capture. Future full recordings
should retain the original wire types and document their redactions here.

## Worker-management projection

`test/gateway/worker-management.test.ts` reuses the recorded field's ISO-string
`createdAt` for its Model/Estimate board fields, changing only fixture identifiers,
field names/types and select options to exercise delivery writes.

## Issue/board housekeeping projections (PR #40)

Recorded 2026-10-17 through the built gateway CLI, read-only:

- `gh-read repos/vworlds/vmethod/issues/37`: `issue-response.json` retains the
  issue representation's number, node ID, state and timestamp fields. Other fields
  (including text and identities) are omitted. The same issue representation is
  returned by create and close; create tests project only number and node ID.
- `gh-read .tmp/board-record.graphql`: project #5 ID, README and fields. The fixture
  retains Status (two options), Estimate and Progress, with original IDs, dates
  and wire types.
- `gh-read .tmp/issue-card.graphql`: issue #39 and its projectItems relation supply
  the card ID, content fields and fieldValues. `board-write-inputs.json` re-envelopes
  those recorded values as the BoardCards query's `content`/`items` shape; the
  `Issue` discriminator is explicit. Other cards/fields/options are omitted.

Board-write tests exercise these inputs through real snapshot/card decoding and
mutation encoding. Mutation response envelopes retain only the selected
`projectV2Item { id }` from this recorded item; they are projections, **not a live
write recording**. The orchestrator owns live write smoke under amendment 1.
Scratch captures remain ignored; no credentials or unfiltered text are committed.

## Legacy task bodies (PR #44)

`legacy-task-bodies.json` retains only branch names and the opening/closing body
lines relevant to issue resolution. The vecs excerpt was read through
`vmethod read pr vworlds/vecs#345` on 2026-10-17. The SpaceRocks excerpt is the
verified orchestrator's PR #44 AMENDMENT 1 recording (its abbreviated link is
preserved and its keyword placeholder expanded). These are body projections,
not complete API response captures. Tests rename repository scope only and
exercise the real merge follow-up with unexpected requests rejected.
