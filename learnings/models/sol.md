# sol model learnings

Generated advice, never policy. Review against the cited delivery threads before committing.

- Use real consumer files as fixtures for compatibility work. Synthetic fixtures passed while review twice found unsupported models.tsv formats in actual consumers. [PR](https://github.com/vworlds/vmethod/pull/14)
- Pair automated checks with focused live smoke tests for integrations. Live review exposed stripped PR metadata, incomplete history pagination, and a worktree listing aborted by one failed size measurement. [PR](https://github.com/vworlds/vmethod/pull/53) [PR](https://github.com/vworlds/vmethod/pull/134) [PR](https://github.com/vworlds/vmethod/pull/144)
- Sol is a promising choice for citation-constrained aggregation: the annotated live trial reported all five views correctly cited. This is evidence from one delivery, not a general reliability guarantee. [PR](https://github.com/vworlds/vmethod/pull/197)
- Reproduce reported failures before changing production behavior. In the closed-card delivery, both acceptance reproductions already passed, so no closed-card production change was made. [PR](https://github.com/vworlds/vmethod/pull/58)
- Do not treat every additional round as an implementation failure. One delivery required a redesign because the orchestrator identified a flaw in its own specification; another needed a moved-base integration without changing the task diff. [PR](https://github.com/vworlds/vmethod/pull/52) [PR](https://github.com/vworlds/vmethod/pull/44)
