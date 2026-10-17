# First learning submission regression fixtures

`learning-47.json` projects vimescmd's read-only captures on 2026-10-17 through
`vmethod gh-read` at dev `684669c`, supplied in the authenticated answer on PR 49.
Sources: `/repos/vworlds/vmethod/pulls/47`, its `/files`, and head `/check-runs`.
Only required fields are retained; gateway-added attribution and patches are removed.

The gateway stripped `head.repo` and all `base` fields from the PR capture and
reduced checks to appId/headSha/status/conclusion. Tests explicitly reconstruct
documented REST envelopes, not additional recordings: fork full_name is
`vimescmd/vmethod` (task and capture manifest), base is central `dev` with a
synthetic SHA, and check id/name/app/head_sha are derived. Check conclusions are
changed to success for green scenarios. Registry contents derive from the existing
recorded contents envelope with a synthetic, explicit project binding.

PR 52's authenticated review changes submission policy to add-only project files.
The original PR 47 file recording remains unchanged and now exercises denial of
legacy seed modification. Successful label/CI boundary scenarios explicitly derive
an `added` per-submission JSONL path, retaining all other captured file fields.

The label 403 is derived from run 39033957432's failure as authorized in the answer:
`POST /repos/vworlds/vmethod/issues/47/labels` is the only write after successful
reads. Run 39033957431 failed on the missing `changes/unreleased/47.md` fragment.
Tests simulate these failures offline; workflow permissions and the live rerun
remain orchestrator review/post-merge acceptance, not proof from a fake token.
