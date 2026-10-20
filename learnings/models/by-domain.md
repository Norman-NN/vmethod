# Model learnings by domain

Generated advice, never policy.

## compatibility-and-cli-packaging

Generated advice, never policy. Review against the cited delivery threads before committing.

- Use verbatim consumer fixtures, nested-directory invocation tests, and external consumer installations. These checks address real-file parsing mismatches, root discovery, and dependency isolation that synthetic in-repository tests can miss. [PR](https://github.com/vworlds/vmethod/pull/14) [PR](https://github.com/vworlds/vmethod/pull/23) [PR](https://github.com/vworlds/vmethod/pull/32)
- Check changelog filename and kind conventions before the first CI push; multiple deliveries needed follow-up corrections despite otherwise successful implementation checks. [PR](https://github.com/vworlds/vmethod/pull/104) [PR](https://github.com/vworlds/vmethod/pull/185) [PR](https://github.com/vworlds/vmethod/pull/187)

## watchers-concurrency-and-event-delivery

Generated advice, never policy. Review against the cited delivery threads before committing.

- Test contention and event interleavings explicitly: fresh versus abandoned locks, brief versus sustained contention, polling between handoff writes, and queued answers after conflict-fixer replies. [PR](https://github.com/vworlds/vmethod/pull/22) [PR](https://github.com/vworlds/vmethod/pull/108) [PR](https://github.com/vworlds/vmethod/pull/178) [PR](https://github.com/vworlds/vmethod/pull/184) [PR](https://github.com/vworlds/vmethod/pull/198)
- Exercise failed-fetch retention, successful replacement, restart, and replay paths. Do not promote a regression-discovered gap into a proven incident cause when the annotation explicitly leaves that cause unproven. [PR](https://github.com/vworlds/vmethod/pull/162) [PR](https://github.com/vworlds/vmethod/pull/71)

## ci-and-live-verification

Generated advice, never policy. Review against the cited delivery threads before committing.

- Tie CI observations to the current head and current base, and distinguish pending registration from failure. Stale verdicts and CI registration races caused misleading worker stops. [PR](https://github.com/vworlds/vmethod/pull/183) [PR](https://github.com/vworlds/vmethod/pull/143) [PR](https://github.com/vworlds/vmethod/pull/21) [PR](https://github.com/vworlds/vmethod/pull/179)
- Supplement green offline suites with targeted live smoke tests. Real runs exposed API timestamp mismatches, structural metadata loss, and failure handling that automated checks had missed. [PR](https://github.com/vworlds/vmethod/pull/24) [PR](https://github.com/vworlds/vmethod/pull/53) [PR](https://github.com/vworlds/vmethod/pull/144)
- For load-sensitive child-process tests, measure workload-specific budgets and repeat the full suite under parallel load rather than relying on a single successful rerun. [PR](https://github.com/vworlds/vmethod/pull/34)

## cost-accounting-and-telemetry

Generated advice, never policy. Review against the cited delivery threads before committing.

- Test complete history pagination, model switches, repeated models, inconsistent usage, and token-bearing compaction messages before trusting exact cost totals. [PR](https://github.com/vworlds/vmethod/pull/134) [PR](https://github.com/vworlds/vmethod/pull/139) [PR](https://github.com/vworlds/vmethod/pull/161)
- Choose display-boundary fixtures that actually change formatted cents, and test unchanged text and null clearing. A watcher cost test was initially blocked because its chosen value still formatted to the same amount. [PR](https://github.com/vworlds/vmethod/pull/123)
- Keep cost comparisons provisional when coverage is partial or deliveries mix models; the existing-branch delivery does not support a clean whole-task price comparison between families. [PR](https://github.com/vworlds/vmethod/pull/187)

## structured-annotation-and-aggregation

Generated advice, never policy. Review against the cited delivery threads before committing.

- State citation allowlists in the generation prompt and validate the output. In the annotated trial, Luna still produced cross-family citations after retry, while Sol produced all five correctly cited views; this is a trial-specific result. [PR](https://github.com/vworlds/vmethod/pull/197)
- Test live model output formatting, continue batches after individual failures, and identify failed PRs in errors. Live review found fence-wrapped JSON and first-error batch aborts; sparse round-cause annotations remained a documented limitation. [PR](https://github.com/vworlds/vmethod/pull/197)

## task-scoping-and-completion

Generated advice, never policy. Review against the cited delivery threads before committing.

- Translate scope into explicit acceptance cases, including required regressions and completion reporting. Missing scope, missing tests, and pushed-but-unannounced completion all appeared in the annotations. [PR](https://github.com/vworlds/vmethod/pull/105) [PR](https://github.com/vworlds/vmethod/pull/184) [PR](https://github.com/vworlds/vmethod/pull/102)
- Separate implementation rework from specification changes and moved-base integration when interpreting round counts. [PR](https://github.com/vworlds/vmethod/pull/52) [PR](https://github.com/vworlds/vmethod/pull/94) [PR](https://github.com/vworlds/vmethod/pull/44)

## conflict-resolution-and-cleanup

Generated advice, never policy. Review against the cited delivery threads before committing.

- For conflict-only work, preserve both behaviors, inspect the resulting diff, and test for unrelated edits. A disposable fixer resolved a conflict but added an unrelated changelog commit; the tightened prompt was not subsequently tested live. [PR](https://github.com/vworlds/vmethod/pull/148) [PR](https://github.com/vworlds/vmethod/pull/155)
- Make cleanup idempotent and auxiliary measurements best-effort, and distinguish automated coverage from live acceptance still outstanding. [PR](https://github.com/vworlds/vmethod/pull/144) [PR](https://github.com/vworlds/vmethod/pull/153)
