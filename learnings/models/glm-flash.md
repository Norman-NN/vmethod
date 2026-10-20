# glm-flash model learnings

Generated advice, never policy. Review against the cited delivery threads before committing.

- Consider a measured trial on small, well-specified CLI tasks. The annotated existing-branch delivery reported first-pass READY, green CI, and no review findings, but it included an initial Sol segment and partial cost coverage. [PR](https://github.com/vworlds/vmethod/pull/187)
- Provide an explicit resolution for specification gaps and acceptance-mapped tests. After a Luna-to-GLM-Flash handoff, the model-default delivery reported coverage of empty reasons, malformed markers, persistence, and unchanged default paths; this does not make the whole delivery GLM-Flash-only. [PR](https://github.com/vworlds/vmethod/pull/191)
- Review migration diagnostics and event attribution beyond happy-path acceptance. Separate deliveries needed revisions for silent configuration degradation and for a stale-wake guard that could discard an unanswered ANSWER. [PR](https://github.com/vworlds/vmethod/pull/196) [PR](https://github.com/vworlds/vmethod/pull/198)
- When using GLM-Flash for structured annotation, test actual response formatting: a live response wrapped in a Markdown fence broke JSON decoding in the learning pipeline. [PR](https://github.com/vworlds/vmethod/pull/197)
- Keep conflict-only assignments narrow and verify the resulting diff. One annotated conflict handoff preserved both tests; another escalated when the remerge diff extended beyond conflicted hunks. [PR](https://github.com/vworlds/vmethod/pull/155) [PR](https://github.com/vworlds/vmethod/pull/197)
