# Testpaq whole-application forensic review

> Historical review checkpoint, recorded before fixes. See [the remediation report](REMEDIATION.md) for fixes and subsequent validation.

Reviewed 12 October 2026 against baseline commit `35ad734` (v0.2), plus the completed, uncommitted v0.3 implementation in this workspace.

**Assessment:** The core architecture is appropriate for a local QA workbench, and the normal workflows pass their automated checks. The application has reproducible correctness and recovery defects, a hostname-validation security gap, and dependency advisories requiring triage. Address the high-priority findings before treating this build as release-ready.

**No remediation was applied during this review.** The implementation was frozen before investigation. Audit probes used synthetic fixtures, mocked providers, in-memory databases and temporary databases; the user's live workspace database and real API credentials were not accessed.

## Scope and method

This review covers the whole application, including inherited v0.1/v0.2 behavior:

| Area                      | Inspection and validation                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup and configuration | CLI arguments, loopback binding, environment loading, install/build/run script, shutdown and browser launch                                          |
| Persistence               | SQLite schema, migrations, aggregates, groups, analysis history, foreign keys and multi-instance ownership                                           |
| API and security          | All routes, request validation, origin/session controls, static serving, error handling and request limits                                           |
| AI and refresh            | Provider boundary, request payloads, credentials, model selection, error classification, deduplication, provenance and transaction boundaries        |
| UI workflows              | Navigation, Testpaq/group management, autosave, ticket editing, review/filtering/shortcuts/undo, questions, history, completion, settings and themes |
| Exports                   | Markdown, Qase CSV selection, field values, quoting, handoff and export status                                                                       |
| Quality controls          | TypeScript, ESLint, formatting, build, test coverage, package metadata and dependency advisories                                                     |

Evidence includes code inspection, 56 passing repository tests across 15 files, two additional temporary UI reproduction tests, isolated server probes, a real loopback HTTP probe, the published Qase template, and `npm audit`/`npm ls`. The temporary UI probes were removed from the repository after running; production code remained unchanged throughout the review.

Lint, TypeScript checking, production build and formatting passed. Build output contained non-failing dependency annotation warnings and the expected missing-key warning.

This was not a live OpenAI generation test, an actual Qase import, a real browser DNS-rebinding exploit, a cross-platform CLI test or a visual/accessibility browser audit. Those limits matter when assessing release readiness.

## Findings

| ID  | Priority              | Finding                                                                   | Origin                                                        | Evidence                                                   |
| --- | --------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| F01 | High                  | Scenario undo can discard unrelated newer edits                           | Inherited                                                     | UI reproduction                                            |
| F02 | High                  | Second service instance changes live analysis history                     | Inherited                                                     | Two database connections                                   |
| F03 | High                  | Untrusted hostnames can obtain the session token and pass mutation checks | Inherited                                                     | Real HTTP reproduction; browser exploit not established    |
| F04 | High, advisory triage | Locked dependency tree contains critical/high advisories                  | Inherited dependency versions                                 | npm advisory audit; product exploitability not established |
| F05 | Medium                | Concurrent API access checks can verify the wrong selected model          | Inherited race; v0.3 model selection exposes it more directly | Concurrent mocked requests                                 |
| F06 | Medium                | Failed completion save leaves the UI showing Completed                    | v0.3                                                          | UI reproduction                                            |
| F07 | Medium                | Completed-content edits are accepted by the API without reopening         | v0.3                                                          | API reproduction                                           |
| F08 | Medium                | Requirement labels differ between screens after rejection                 | Inherited                                                     | Deterministic numbering reproduction                       |
| F09 | Medium                | AI payload drops requirement active/inactive state                        | Inherited                                                     | Captured provider request                                  |
| F10 | Low                   | Aggregate validation accepts duplicate entity IDs                         | Inherited                                                     | Schema reproduction                                        |

### F01 — Scenario undo restores the entire Testpaq

Locations: [snapshot capture](src/components/panels/ReviewPanel.tsx#L52), [undo application](src/components/panels/ReviewPanel.tsx#L285).

A review mutation saves a full aggregate snapshot. Undo later replaces the entire current aggregate with that snapshot, rather than reversing the affected scenario fields.

Reproduction: reject a scenario, change the ticket description while the review component remains mounted, then click Undo. The new description disappears. A temporary UI test reproduced this. In the normal workbench, project-group assignment is accessible above the review panel; changing it after a review action exposes the same aggregate replacement problem. Edits to a scenario after a review action can also be lost.

Impact: unrelated user decisions can be silently discarded and then autosaved. This issue was already identified in the v0.2 review and remains present.

Suggested remedy, not applied: store only the affected scenario fields/IDs, reverse only those changes, and invalidate undo when affected scenarios change subsequently. Cover unrelated group/ticket edits and scenario edits with regression tests.

### F02 — Startup assumes exclusive database ownership without enforcing it

Locations: [startup recovery](server/store.ts#L19), [CLI store creation](server/cli.ts#L29), [run completion](server/store.ts#L198).

Every new store marks all `running` Analysis Runs as failed/interrupted. The CLI has no database ownership lock, so a second launch can perform this recovery against work still running in the first service.

Reproduction: open service/store A against a temporary SQLite file and start a run; open store B against the same file. A now reads `failed / interrupted`. When A finishes its run, the record becomes `succeeded / interrupted`, because success does not clear the previous error code.

Impact: inaccurate analysis history and no reliable exclusivity assumption. Multiple processes also sit outside the single-service, synchronous read/version-check/write protection used for tab conflicts. This review reproduced history corruption; it did not reproduce a cross-process lost-save race.

Suggested remedy, not applied: enforce a per-database launch lock, establish ownership before recovering interrupted runs, and clear incompatible error metadata on successful completion.

### F03 — Hostname validation is missing

Locations: [origin/session middleware](server/app.ts#L59), [served HTML token](server/app.ts#L323), [loopback listener](server/cli.ts#L50).

Production uses `allowedOrigin: "self"`, deriving the expected origin from the incoming request URL. The listener is loopback-only, but neither it nor the app restricts the Host hostname to loopback names. GET requests can retrieve the HTML containing the session token.

A real isolated HTTP server returned `200` with the dummy launch token for `Host: untrusted.example:<port>`. A subsequent mutation using that hostname as Origin and the obtained token returned `201`. Node's HTTP client was used to preserve the Host header.

Impact: loopback binding and same-origin validation do not provide an independent hostname boundary. This is a prerequisite for a DNS-rebinding attack in a browser environment where such requests are allowed. Browser private-network protections, DNS behavior and a full exploit chain were not tested; the confirmed finding is server acceptance of the untrusted hostname and its matching origin.

Suggested remedy, not applied: reject untrusted Host values before serving HTML or APIs, derive the allowed origin from trusted listener configuration, and test hostname, origin, token and static-page access together.

### F04 — Dependency audit reports six affected package entries

`npm audit --json` reported **4 critical, 1 high and 1 moderate package entries**. These are dependency-graph counts, including parent packages affected through dependencies; they are not six independent confirmed Testpaq exploits.

Installed paths and advisory evidence:

| Path                                       | Installed version    | Advisory class                                                           |
| ------------------------------------------ | -------------------- | ------------------------------------------------------------------------ |
| concurrently → shell-quote                 | shell-quote 1.9.0    | Command injection, advisory critical                                     |
| vitest → tinypool                          | tinypool 1.1.1       | Prototype-pollution gadgets leading to code execution, advisory critical |
| vitest → @vitest/mocker                    | @vitest/mocker 3.2.7 | Path traversal/arbitrary file read, advisory moderate                    |
| Tailwind/Vite/jsdom chains → source-map-js | source-map-js 1.2.1  | Source-map processing denial of service, advisory high                   |

Sources: [shell-quote advisory](https://github.com/advisories/GHSA-pqg4-j6r4-53mv), [Tinypool advisory](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3), [Vitest mocker advisory](https://github.com/advisories/GHSA-82fw-gwwq-j7x9), [source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

Most affected paths concern development, testing or building. `@tailwindcss/vite` is declared under production dependencies despite being build tooling. No route from normal pasted ticket content to these vulnerable operations was demonstrated. Their advisory severities should not be presented as demonstrated remote code execution in the running Testpaq app.

Suggested remedy, not applied: review reachable operations and advisory prerequisites, update the lockfile intentionally, move build-only tooling to devDependencies, and verify compatibility. npm proposes a major Vitest upgrade for some paths; do not apply an indiscriminate audit fix.

### F05 — Access-check locking is not atomic

Location: [model and access-check routes](server/app.ts#L78).

The `checking` guard is read before awaiting request-body parsing, and set afterward. Two requests can both pass the guard. A model change can also pass its guard before another request starts checking. Results write shared provider status without binding the result to the provider instance actually checked.

Reproduction: submit checks for good-model and bad-model concurrently. Both entered the mocked provider. Fail bad-model first, then succeed good-model. Final configuration was `model: bad-model` with `providerStatus.status: ready`.

Impact: misleading verification and concurrent billable requests despite the intended single-check guard. The guard ordering existed in v0.2; persistent model selection adds another operation sharing this state.

Suggested remedy, not applied: acquire/check the lock after parsing and before provider mutation, capture the exact provider being checked, and apply results only if it remains current. Add overlapping-request tests.

### F06 — Completion is displayed before its save succeeds

Location: [completion transition](src/components/TestpaqWorkbench.tsx#L167).

The transition changes local status and disables editing before persistence. Failure only sets an error; it does not roll back the transition or clearly distinguish provisional completion.

Reproduction: make `api.save` reject, then click Mark completed. The UI shows Reopen Testpaq, disables Description, and displays Save failed, while the persisted item remains in its previous state. A temporary UI test confirmed this.

Impact: completion is ambiguous during persistence or stale-tab failures. Recovery currently relies on subsequent saves or reopening rather than an explicit retry/rollback flow.

Suggested remedy, not applied: commit the transition after save success, or make provisional state explicit and restore the prior state on failure while preserving the user's draft.

### F07 — Completion protection exists in the UI and analysis route, not aggregate saves

Locations: [aggregate PUT](server/app.ts#L191), [completed-analysis rejection](server/app.ts#L250).

After completion, an authenticated PUT can change ticket content or scenarios while retaining `status: completed`. Reopening is not required by the server.

Reproduction: complete a fixture, then PUT a changed description using the latest saved version while keeping Completed. Response `200`; persisted description changed and status remained Completed.

Impact: clients using the local API can alter the completed review snapshot without a reopening decision. This is a consistency defect in the newly implemented completion contract, not an authentication bypass.

Suggested remedy, not applied: define allowed completed-state mutations explicitly, enforce content-changing transitions server-side, and permit export metadata updates without requiring reopening.

### F08 — Requirement numbering is inconsistent

Locations: [ticket requirement labels](src/components/panels/TicketPanel.tsx#L96), [active numbering](src/shared/export.ts#L83), [scenario labels](src/components/panels/ReviewPanel.tsx#L360).

Ticket view numbers all requirements by array position. Review, questions and export renumber only active requirements.

Reproduction: reject the first requirement. The second requirement remains R2 on the ticket screen but appears as R1 in review/export. Underlying UUID links remain correct.

Impact: users can discuss or review the wrong displayed requirement number even though stored traceability is intact.

Suggested remedy, not applied: use a single consistent numbering convention, preferably durable labels if numbers are used in handoffs.

### F09 — The provider cannot distinguish inactive requirements from active ones

Location: [provider input mapping](server/provider.ts#L53).

The aggregate/history retains `active`, but the actual model payload maps requirements to only clientId, text and source. The system prompt instructs the model not to revive inactive requirements without supplying the necessary state.

Reproduction: send a fixture with its first requirement inactive through a captured mocked provider. The payload had no active flag for that requirement.

Impact: the model may continue proposing coverage for rejected scope. The merge correctly keeps an existing requirement inactive, so this is not proof of automatic reactivation; it is a loss of context and a source of unwanted proposals linked to inactive scope.

Suggested remedy, not applied: transmit active/inactive state, explain its semantics in the prompt, and test the serialized request independently of the input snapshot.

### F10 — Aggregate IDs are not required to be unique

Location: [aggregate invariants](src/shared/domain.ts#L90).

The validator checks links against sets but does not compare set sizes against entity counts. A duplicate scenario ID passes validation. Equivalent uniqueness checks are also absent for requirements and questions.

Reproduction: append a clone of an existing scenario to a fixture; `TestpaqSchema.safeParse(...).success` returned true.

Impact: malformed authenticated saves can persist ambiguous links and duplicate React keys. Normal UI UUID generation makes accidental occurrence unlikely; model-result client IDs are separately validated for uniqueness.

Suggested remedy, not applied: enforce uniqueness for aggregate entities and avoid repeated requirement-link IDs.

## Code quality and implementation assessment

The architecture has useful boundaries: shared runtime schemas, a narrow provider interface, a deterministic export layer, parameterized SQL and transactional analysis application. Provider switching uses immutable instances, so an in-flight analysis keeps its captured model. Credentials remain server-side, Responses storage is disabled, and ticket content is treated as untrusted model input.

The strongest tests cover analysis rollback, stale-tab conflicts, answer-aware refresh, preserved human decisions, migrations, model persistence, CSV escaping and failed clipboard handoff. The v0.3 Qase file matches the full published v2 header order, uses the documented automation slugs and includes accepted Qase/Cypress selections once each. References: [Qase CSV steps/template guidance](https://docs.qase.io/en/articles/14441496-qase-csv-adding-test-steps), [automation/status slugs](https://docs.qase.io/en/articles/14423241-qase-csv-test-case-properties), [OpenAI model-list API](https://developers.openai.com/api/reference/resources/models/methods/list).

Maintainability pressure is concentrated in `TestpaqWorkbench`: refs, revisions, save queues, timers, transition state and export coordination are intertwined. A focused persistence/transition hook would make failure behavior easier to reason about. Server configuration response objects are repeated across routes, while provider state is captured correctly during analysis but not during access checks. Centralizing this logic would reduce inconsistent behavior.

The exported case action is the scenario title and its result is the expected outcome. This is a deliberate mapping of the existing domain model, not a generated procedural test script. If detailed setup, multiple steps or datasets are required, they need a reviewed case-detail model; the CSV exporter should not invent them. Downloading a CSV does not prove Qase import or Cypress implementation.

## Remaining gaps and limitations

- There is no complete backup/restore workflow or pre-migration backup. The v0.3 migration is transactional and preserves tested fixture history/groups, but a transaction is not recovery from disk loss or an incorrect future migration.
- Failed autosaves/stale-tab conflicts still lack a durable draft buffer, comparison/merge and visible retry. Blank required text can produce a generic validation failure; several ticket/scenario inputs do not enforce the schema's size limits before save.
- Refresh does not show a change diff, flag accepted scenarios affected by changed scope or automatically archive removed scope. Reviewed coverage is intentionally retained, so users must assess it manually.
- Exact normalized-text/title matching can collapse same-title proposals or retain semantic paraphrases as duplicates. This is a documented identity limitation, not a reliable semantic matcher.
- Model discovery lists account model IDs without guaranteeing Responses/structured-output compatibility. Compatibility and billing are different checks. Provider guidance still mentions the environment variable for model errors, which is less helpful now that a saved UI preference takes precedence.
- Completed panels use disabled/inert containers, which also prevent filtering and expanding scenario details or switching question filters. Reading all completed details needs browser/user validation; reopening currently restores those controls.
- The CLI lacks dedicated listen-error presentation. Tests cover successful startup configuration, but occupied-port behavior and shutdown during slow live analysis need further operational validation.
- List/history read paths load entire aggregate/history payloads; no pagination or large-workspace benchmark was performed. The 200-scenario fixture is not evidence of scalability across thousands of Testpaqs.
- Native datalist behavior, download handling, mobile layout, focus and screen-reader behavior have not been browser-verified in this review.
- Repository tests mock OpenAI. No real API request, actual Qase import or import round trip was performed. No source-code review can replace those integration checks.

## Proposed remediation order — not executed

1. Prevent unrelated-edit loss from undo, enforce single-instance database ownership, and add trusted-host checks.
2. Triage and intentionally update affected dependency paths.
3. Make access-check state atomic and completion persistence/server transitions consistent.
4. Align requirement numbering, transmit inactive scope and enforce aggregate ID uniqueness.
5. Add backup/recovery and browser/live-service verification before wider rollout.

The normal-path checks pass, but the findings above remain open. This report is the review checkpoint requested before any fixes.
