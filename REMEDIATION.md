# Whole-application remediation

The [forensic review](FORENSIC_REVIEW.md) is the historical checkpoint requested before fixes. This report records the subsequent v0.3 work and remediation, including inherited defects.

## Confirmed findings

| Finding                                    | Implemented fix                                                                                                               | Regression evidence                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| F01: Undo loses unrelated edits            | Undo restores only affected scenarios and expires after those scenarios change.                                               | Review-panel tests preserve unrelated edits and reject obsolete undo. |
| F02: Second instance corrupts live history | Exclusive database ownership precedes startup recovery; successful runs clear failure metadata.                               | File-database second-owner test and history tests.                    |
| F03: Untrusted Host accepted               | Hostnames restricted to loopback before HTML or API access; Host must match request URL.                                      | API tests and a real HTTP request with an untrusted Host.             |
| F04: Dependency advisories                 | Updated Vitest and affected transitive dependencies; moved build tooling to devDependencies.                                  | Full checks and fresh npm audit.                                      |
| F05: Access-check race                     | Check guard acquired after parsing, before mutation; results bound to captured provider. Model changes blocked during checks. | Concurrent access-check and model-change tests.                       |
| F06: Failed completion looks successful    | Displayed completion changes only after pending edits and the transition save succeed.                                        | Failed-save UI regression test.                                       |
| F07: Completed API content editable        | Server rejects content changes on completion/reopening transitions and while completed; export metadata remains permitted.    | Completed aggregate mutation tests.                                   |
| F08: Requirement labels inconsistent       | Active references retain original requirement positions across screens and exports.                                           | Numbering/export regression tests.                                    |
| F09: Inactive scope omitted                | Provider payload includes each requirement's active state.                                                                    | Captured provider request assertion.                                  |
| F10: Duplicate aggregate IDs               | Runtime schemas enforce unique entity IDs and requirement links.                                                              | Invalid aggregate validation tests.                                   |

## Additional review gaps addressed

- **Recovery:** Complete validated JSON backup/restore, transactional replacement, pre-restore/pre-migration SQLite snapshots, durable browser drafts, explicit retry and three-way conflict comparison.
- **Refresh:** Added/changed/retained summaries, accepted-case scope-review flags, archive/restore controls, run provenance and stricter identity matching for cases sharing a title. Change counts ignore timestamp-only updates. Archived cases are excluded from exports and coverage.
- **Completed inspection:** Filters, expansion and history remain usable without reopening; mutation controls remain protected.
- **Validation:** Field length limits, invalid-field feedback and save validation accompany stricter aggregate invariants.
- **Operations:** Friendly database/listen failures, abort-aware analysis and bounded shutdown. List/search and history routes are paginated; list queries read summaries rather than hydrate all aggregates.
- **Browser coverage:** A reproducible Chromium workflow checks real HTTP Host rejection, autosave/refresh, downloaded CSV content, completion/read-only expansion, saved model choice, downloaded backups, dark mode and mobile overflow. The mobile check uncovered and led to fixing top-bar overflow. The README gallery is captured from this running app using synthetic fixtures.
- **Documentation:** Human-readable README, separate technical guide, preserved historical audit and this remediation record.

## Validation and boundaries

Validation passed: **72 tests across 16 files**, ESLint, TypeScript, formatting, production build and the Chromium workflow. A fresh `npm audit` reported **zero vulnerabilities**, including development dependencies. Build warnings were limited to a missing optional API key and third-party annotation handling.

Browser and provider tests use synthetic data and a deterministic provider. No real OpenAI generation or actual Qase import was performed; those account-dependent integration checks remain necessary. Model listing is deliberately not a compatibility or billing guarantee. Exact identity matching is not semantic deduplication, and retained reviewed cases require a human scope decision rather than automatic deletion. Pagination reduces list/history loading; it is not a benchmark of unlimited workspace size. Browser checks do not certify comprehensive screen-reader accessibility or all operating systems.

## Linked-case extension within v0.3

Coverage outputs now have independent linked test cases, with manually authored, AI-generated or explicitly converted proposals. Qase exports their reviewed ordered steps, data, conditions and local case/parent IDs; coverage summaries alone are no longer exported as cases. Existing coverage and decisions remain intact. Scope changes, missing details, archived parents/cases and unaccepted proposals prevent CSV inclusion. Draft recovery merges independently added cases and returns merged content changes to Proposed.

Cypress implementation is outside this release. The generic To be automated option only sets Qase's planning status. Additional tests cover generation context/history, malformed-output rollback, concurrent changes, backup/restore, one-to-many review, stale scope, legacy conversion, multi-step quoting and draft recovery. Browser verification includes the linked-case workflow and completed/mobile inspection. The original forensic checkpoint remains historical.

Linked-case validation: **84 tests across 19 files**, including retained original regression coverage. Lint, TypeScript, build, formatting and the expanded Chromium workflow passed. Live OpenAI and actual Qase account import remain unverified.
