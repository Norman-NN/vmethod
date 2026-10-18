# Legacy worker fixtures

Exercise recorded bash worker files without importing live state.

`records.json` stores filenames as `key` and exact file bytes as `content`:

- **SpaceRocks, recorded:** copied by vimescmd on 2026-10-18 from
  `~/.local/state/spacerocks-orchestrator/workers/`, supplied in PR 70's
  authenticated ANSWER through `.tmp/captures/`. Filenames are unchanged; only
  session ids were replaced. Each file is a 30-character bare id plus newline
  (31 bytes). The probe key is not a task. The task keys identify PRs 290 and 295.
- **Vecs, format-derived:** key from the vecs PR 370 adoption amendment; bare-id
  shape shared with SpaceRocks, not a recording of a vecs file.
- **Claude, format-derived:** `key=value` shape described on vmethod issue 61.
  No real Claude record was available (the captured directory was empty).
  Non-id fields deliberately demonstrate that legacy metadata is not trusted.

Tests relocate the encoded checkout prefix into their temporary checkout while
preserving the worktree basename and content bytes. Opencode responses use the
existing adoption test response shape; these file fixtures do not purport to be
new server-response recordings.

`spacerocksPrHeader` records the opening header of
<https://github.com/vworlds/spacerocks/pull/346>, read through the gateway on
2026-10-18. It has both a quoted `Agent task for` relation and a closing relation,
but no opening Estimate marker. Gateway tests project issue 342 to issue 9 and
branch 346-rogue-looter to 9-task; all other header text is unchanged.
