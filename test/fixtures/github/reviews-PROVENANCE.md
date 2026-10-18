# Review connection recordings

Captured 2026-10-18 by vimescmd through `vmethod gh-read` against vworlds/vmethod
PRs 14 and 16. Only gateway-added `attribution` fields were removed. IDs, enum
values, nested objects and SHA strings retain their recorded wire types.

Selection: `headRefOid reviews(last: 100) { nodes { id state commit { oid }
author { __typename login ... on User { databaseId } ... on Bot { databaseId } } } }`.

- `owner-reviews.json`: PR 14, an owner APPROVED review on the current head.
- `orchestrator-reviews.json`: PR 16, two COMMENTED orchestrator reviews on an older head.

Watcher tests project the recorded PR fields onto the existing recorded board
card shape. Scenario variants substitute pinned fixture identities, head SHAs,
review IDs and review state to exercise authorization, stale heads and new events.
