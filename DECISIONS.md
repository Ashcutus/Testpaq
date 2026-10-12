# Implementation decisions

Only decisions that clarify the product/architecture baseline are recorded here.

## Aggregate persistence

The Testpaq document (ticket, requirements, scenarios, questions, and their links) is persisted as one validated JSON aggregate in SQLite, with indexed summary columns. This makes autosave and bulk review mutations atomic without introducing an ORM. Analysis Runs are separate relational rows with a foreign key so their history survives Testpaq edits. Domain objects remain first-class and runtime-validated even though every child does not have its own table in v0.1.

## OpenAI credential storage

v0.1 uses `OPENAI_API_KEY` rather than writing credentials to SQLite or adding a fragile cross-platform secret-store dependency. The token exists only in the server process. OS credential-store integration is deferred until packaging requirements are known.

## Development fixtures

Fixture creation routes exist only when `TESTPAQ_ENABLE_FIXTURES=1` (the development script sets it). Production does not expose fixture routes or controls.

## Local session protection

Each production launch creates a random token embedded in the served HTML. Mutating requests require it in a custom header and must have the expected loopback origin. The token is not printed, persisted, or put in the URL. This is proportionate CSRF/casual-process protection for a single-user loopback application, not an account system.

## v0.2 environment and billing

The CLI uses Node's native `.env` loader before constructing its provider. Shell variables win; a working-directory file wins over repository defaults. A linked CLI can find its repository `.env` even when launched elsewhere. Builds warn rather than fail without a key because manual work is supported. The single run script tracks the lockfile and Node ABI, installs when required, builds and starts.

The connection dialog optionally accepts a key held only in local-server memory. Linking explicitly includes a small billable access check; a configured key alone is never described as verified. An ordinary API key has no documented exact-balance endpoint used by this app. The check tests the configured model and leaves exact balances to the billing portal. No request is made on app load, and provider errors are classified without returning raw upstream content. Responses disable server-side response storage.

## v0.2 refresh and grouping

Project groups are durable SQLite rows, with optional membership on the aggregate. Existing aggregates need no payload rewrite. Group deletion atomically removes membership while retaining all Testpaqs.

Refresh sends the current questions/answers and scenarios. Suggestions match existing IDs/titles; reviewed or human edited scenarios and answers remain intact. Old coverage is retained for explicit human review. Changed requirements are added rather than silently rewriting prior provenance. A semantic input signature flags changed ticket scope, requirements or answers.

Analysis merging moved from the browser to an atomic server transaction, with both aggregate and result validated before commit. A timestamp version prevents stale saves and conflicting in-flight analysis. The browser serialises autosaves and carries forward the latest saved version without discarding newer local edits.

## v0.3 model preference and Qase handoff

Model selection creates an immutable provider instance sharing the existing server-side client. An in-flight analysis retains its original model; subsequent analysis uses the selected model. Preferences are persisted separately from credentials, and stale-model analysis requests are rejected before sending ticket content. Account model discovery is user-triggered and does not assert structured-output compatibility or billing access.

Completion is an explicit, reversible human decision, independent of export or execution. Completed Testpaqs remain exportable and require reopening for UI edits and analysis. A new SQLite status constraint is installed transactionally while preserving analysis-run references and project groups.

Qase export is deterministic native v2 CSV, using the full published template and nested step quoting. Accepted Qase or Cypress selections are included once. Existing automation intentions map to Cypress and Qase's `to-be-automated` slug. Blank Qase IDs deliberately create new cases; no remote import success or executable automation is claimed. The current scenario model provides a title and expected outcome, so these map to a single classic action/result pair rather than invented procedural steps.

## Whole-app remediation after the forensic checkpoint

Enforce database ownership before interrupted-run recovery, validate loopback Host values, and commit completion only after persistence. Undo reverses affected scenarios rather than whole aggregates. Workspace backups and pre-change snapshots provide recovery; browser drafts retain pending edits and merge independent changes by stable IDs. Refresh retains reviewed decisions while exposing change summaries, scope-review flags and explicit archives. Lists/history paginate; screenshots and browser checks use synthetic data. Historical findings remain in FORENSIC_REVIEW.md; REMEDIATION.md records the fixes.
