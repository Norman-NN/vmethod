# Actions viewer identity shape

The authenticated orchestrator ANSWER on task PR 67 supplied this GraphQL bot
viewer shape after reporting the identity-pin failure from CI run 39078450548.
The fixture preserves the supplied login, numeric ID and account type verbatim;
it is not an independent capture by this worker.

GraphQL uses `github-actions`; REST and the registry use `github-actions[bot]`.
Tests must keep the numeric ID and `Bot` type pinned while comparing those forms.
