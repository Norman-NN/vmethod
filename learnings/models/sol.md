# sol (codexbal/gpt-6.1-sol)

_Distilled 2026-10-19 from vworlds/vmethod grades (learning PR 116) and the shared report._

- **Volume and cost (vmethod, single-model deliveries):** 31 deliveries, 80 points, $61.07, so **about $0.76 per point** and 1.7 rounds per delivery. Shared report: 70 deliveries, 0.45 rounds per point.
- **Strengths:** cross-cutting and multi-part work (watcher, gateway and conflict resolution). It follows amendments, fixes its own failing tests rather than stopping, and answers review points thoroughly.
- **Cost drivers:** long sessions. Context grows to about 245k before auto-compaction, and review rounds re-send it every call (PR 148: $5.98, 58% of it cached-context re-reads). See issue 158 for the levers.
- **Findings:** missed root cause 6%, weak tests 3%, all caught by orchestrator verification. Live smokes caught what fakes missed (PRs 134, 144 and 148).
- **Use for:** cross-cutting tasks, behaviour that existing tests assert, scope settled in discussion, and escalation after a cheaper model stops twice.
