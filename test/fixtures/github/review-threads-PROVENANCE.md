# Inline review-thread recording

Captured by vimescmd on 2026-10-23 through the orchestrator credential, supplied in
the authenticated ANSWER on vworlds/vmethod PR 214. Source: merged PR 213, a
submitted COMMENT review at `changes/unreleased/213.md:1` and its REST reply.

`review-threads.json` projects `data.repository.pullRequest.reviewThreads` from
the supplied GraphQL response. Only repository/PR URLs and author login/ID are
sanitized to the test pins. Node IDs, numeric comment IDs, cursors, timestamps,
nulls and connection structure retain their recorded wire types.

Tests change dates, identities/editors, resolution, line (including null), bodies
and pagination using this shape. The fake projects comments pages through a
`PullRequestReviewThread` node lookup; connection and comment fields are unchanged.
