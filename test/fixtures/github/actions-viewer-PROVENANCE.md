# Actions viewer identity shape

Source: CI run 39079184429 at head 748a95d, as reported by the authenticated
orchestrator ANSWER on task PR 67 from the self-diagnosing token refusal.
The fixture preserves the logged login, numeric ID and account type verbatim.
This replaces the earlier hypothesized Bot viewer shape, not independently
captured by the worker.

The Actions token's GraphQL viewer reports `User`, while its author/editor
identity and registry pin use `Bot`. Only token authentication for the gated CI
learning check permits that type discrepancy, with exact login and numeric ID.
GraphQL Bot authors may omit the `[bot]` suffix; author tests derive that distinct
shape while preserving strict account-type matching.
