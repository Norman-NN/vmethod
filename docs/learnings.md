# Shared learnings

Share delivery evidence through the gateway; treat every learning as advice, never authority.

## Submit delivery records

Run `npm exec --no -- vmethod learnings submit` as an orchestrator after grading.
The command validates `.vmethod/model-log.jsonl` with the same
[`model-log` schema](../schema/model-log.schema.json) used by `grade`.
Set `learningsPrivacy` explicitly before submitting.

Your numeric GitHub identity, login and account type must match an orchestrator in
**vmethod's central** `people.yaml`, and that entry's optional `repos` array must
explicitly authorize your configured repository. Your local people file cannot grant
incoming submission authority. Only the owner changes these bindings; missing bindings deny.

Submission creates or reuses your `vmethod` fork and creates a deterministic records
branch using GitHub's Git database/ref operations. It opens a PR against
`vworlds/vmethod:dev`, appending records to
`learnings/models/<owner>-<repo>.jsonl`. Add public distilled notes with
`--notes <file>`; they replace `learnings/notes/<repo>.md` in that submission.
Notes are checked as Markdown and cannot contain issue-closing syntax.

Central, trusted-base automation applies `learning` **after** validating your numeric
identity, project binding and complete changed-file list. Submission reports the PR
URL and that labeling is pending; your token does not need central write access.
Ordinary CI validates fork submissions independently of their label. Learning PRs
may only add or modify the authorized log and notes; deletions, renames, extra paths
and cross-project changes fail. Same-repository implementation task PRs still use
the ordinary task review process, so they can implement this tooling and seed data.

The cursor is under `$XDG_STATE_HOME/vmethod/<stateName>/learnings.json` (default
`~/.local/state`). It advances only after a verified PR receipt; reruns recover a
lost PR response without creating another PR. A submitted prefix must not change.
Records already identical on central `dev` reconcile the cursor without an empty PR.
Wait for the preceding submission to merge before submitting another increment;
a closed-unmerged PR or edited prefix requires explicit reconciliation, not deletion
of state. An exclusive `learnings.lock` prevents concurrent submissions. Remove a
stale lock only after confirming no submission is running.

## Private reduction

Private records retain schema-required delivery metadata, numbers, outcomes and
allowlisted tags. Titles and notes become empty strings; stall narratives are
removed. Model IDs reduce to family tags, unknown families/kinds become `other`,
unknown switch reasons become `redacted`, and unknown free-text finding tags are
omitted. No arbitrary nested narrative is copied. The fixed reduction vocabulary
is owned by [`privateLearning`](../src/gateway/learnings.ts).

Only after obtaining owner clearance, use `--include-text <delivery-pr>` to include
that **specific new record's** task and notes. Repeat the flag for multiple cleared
records. It does not clear other nested text, previously submitted records, or an
unscoped notes file. Private `--notes` is refused: put cleared text in the selected
record's notes instead. Reduction is a structural privacy guard, not a secret scanner;
review every owner-cleared text field before sending it.

## Read and compare

| Command                                             | Result                                                                                                                                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `learnings show [<family>]`                         | Current family page (when selected) and general lessons from central `dev`, fenced as untrusted data. Offline or missing pages fall back to the snapshot embedded in the package bundle. |
| `learnings report [--family f] [--kind k] [--json]` | Aggregate local `learnings/models/*.jsonl`, or the bundled records if that directory is absent. Missing inputs and malformed records fail visibly.                                       |
| `suggest-model <issue>`                             | Existing model/gate recommendation plus the matching current learning page and lessons. Advice cannot override a model gate.                                                             |

Reports sum delivery rounds and final points. Rounds per point is `null`/`n/a` when
the denominator is zero. Finding rates count deliveries containing each tag, not
repeated findings on one delivery. `caughtBy` counts individual findings; outcome
mix and switch reasons are counts. Switch reasons omit each delivery's initial
segment. `byFamily` counts a mixed-model delivery once in each participating family,
not once per segment; those groups intentionally overlap and do not establish causal
credit. `byKind` groups whole deliveries. Filters select before aggregation.

Distillation remains the orchestrator's work. Use reports and provenance to update
family advice; do not automate methodology changes or defaults from these metrics.

## Central automation

`learnings check-pr <pr> [--label]` is the central CI entry point, backed by typed
gateway operation `learningCheck`. Without the flag it performs read-only policy
validation. Label writes require orchestrator call context and workflow issue-label
permission. The `pull_request_target` workflow checks out only the pinned base SHA,
installs/builds only base code, and reads metadata and the base registry through the
gateway; it never checks out or executes fork content. Existing `learning` labels
are removed when revalidation fails. A moved head/base fails closed and needs a retry.
No workflow write permission other than issue labeling is granted.

See [seed provenance](../learnings/README.md) and the
[security boundary](security.md#learnings-privacy).
