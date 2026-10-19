# luna (codexbal/gpt-6-luna)

_Distilled 2026-10-19 from vworlds/vmethod grades (learning PR 116)._

- **Volume and cost (vmethod, single-model deliveries):** 16 deliveries, 16 points, $1.03, so **about $0.06 per point** and 1.4 rounds per delivery.
- **Good at:** small, single-area tasks whose spec is complete in the issue body (PRs 102, 103, 104, 108, 113 and 151).
- **Failure modes (8 escalations to sol):**
  - ignores PR amendments, and builds rejected options when the scope lives in comments (PRs 104, 105, 109);
  - reports its own red tests as BLOCKED (PRs 119, 124, 177, 188);
  - asks needless "should I continue?" questions, or stops with work remaining (PRs 177, 191).
- **Use for:** tasks of 0.5–1 point with the spec in the body. Escalate after the second stop, or after the first stop on red tests.
