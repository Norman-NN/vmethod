# OpenCode watcher response projections

`watch-status.json` projects the read-only captures supplied by vimescmd in PR
#71 amendment 4, recorded 2026-10-18 (`.tmp/captures/opencode/PROVENANCE.md`).
The active map retains one running entry; session/message IDs and the directory
are renamed. Session model, tokens, outcome and numeric timestamps are retained.
Messages keep only IDs, types and times; prompts, metadata, content, provider
state, snapshots and pagination cursors are omitted. The messages were captured
with `limit=3`, then used as a short result of `limit=20`. All `data` envelopes
and the invalid-request response are retained.

Permission-wait and failed-turn scenarios are explicit derivations: the empty
permission list gains the existing permission test fields; session outcome
becomes `failed` with a scripted error. These are not live stop recordings.
