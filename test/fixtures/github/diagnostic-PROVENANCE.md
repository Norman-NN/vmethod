# Diagnostic REST recordings

Recorded by vimescmd on 2026-10-17 as raw GitHub REST responses for issue #45,
supplied in PR #53 AMENDMENT 1 under `.tmp/captures/`. These fixtures have no
gateway envelope or injected attribution.

- `diagnostic-pulls-open.json`: `/repos/vworlds/vmethod/pulls?state=open&per_page=3`.
- `diagnostic-pulls-closed.json`: corresponding `state=closed` request; first PR only.
- `diagnostic-git-commit.json`: `/repos/vworlds/vmethod/git/commits/56d00ed8149f11620810145ce2075379eac99f18`.
- `diagnostic-commit.json`: corresponding `/commits/56d00ed8149f11620810145ce2075379eac99f18`.
- `diagnostic-compare.json`: `/repos/vworlds/vmethod/compare/f75d5ba...56d00ed8149f11620810145ce2075379eac99f18`;
  final commit only.

Projections retain identity pins, git signatures, timestamps, titles, commit
messages, trees and diagnostic counters with original wire types. Unused fields
(including PR bodies and commit verification payloads) are omitted. Tests add
hostile content and substitute identities explicitly for boundary cases. GraphQL
follow-ups use the existing editor-aware fake, with the recorded PR node IDs.
