# luna model learnings

Generated advice, never policy. Review against the cited delivery threads before committing.

- For bounded fixes, require explicit completion evidence as well as a pushed branch. Two deliveries merged with green CI, but the orchestrator noted that the worker had not posted READY. [PR](https://github.com/vworlds/vmethod/pull/102) [PR](https://github.com/vworlds/vmethod/pull/103)
- Make required regression tests explicit and check them before accepting completion. A lock-wake delivery initially stopped with both required tests missing; another watcher delivery needed review to identify three missing test behaviors. [PR](https://github.com/vworlds/vmethod/pull/184) [PR](https://github.com/vworlds/vmethod/pull/92)
- Review sanitizer examples and identity comparisons directly, even after green checks. Review caught a regex corrupting ordinary text and a case-sensitive comparison of GitHub logins. [PR](https://github.com/vworlds/vmethod/pull/113)
- Distinguish integration or CI-observation problems from worker defects. Annotated pauses included an unrelated concurrent type clash and a stale CI verdict that did not describe the current head. [PR](https://github.com/vworlds/vmethod/pull/114) [PR](https://github.com/vworlds/vmethod/pull/178)
- For incomplete-work stops, respond with concrete remaining acceptance work and consider a model handoff if progress remains stalled. The annotations document such stops and subsequent switches, but the mixed-model merged outcomes do not establish Luna's independent completion ability. [PR](https://github.com/vworlds/vmethod/pull/177) [PR](https://github.com/vworlds/vmethod/pull/188) [PR](https://github.com/vworlds/vmethod/pull/191)
