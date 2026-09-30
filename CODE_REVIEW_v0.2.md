# Testpaq v0.2 code review

Reviewed the complete server, shared domain/export layer, React components, startup/configuration, tests and repository documentation against the requested workflows.

## Findings addressed in v0.2

| Finding                                                            | Effect                                                                                           | Resolution                                                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| CLI never loaded `.env`                                            | A key placed in the documented project directory was invisible to Node unless manually exported  | Load `.env` before provider construction; preserve shell precedence; support linked CLI and an explicit path              |
| Key presence described configuration without a billing check       | UI appeared usable with exhausted credit                                                         | Separate configured/unchecked/verified/error states; explicit small billable check; billing link and distinct error codes |
| Refresh omitted questions, answers and existing scenarios          | Clarifications never affected generation, and each run appended duplicate coverage               | Include current context; merge suggestions; keep human edits, review decisions and answers                                |
| Analysis result applied only by the browser                        | Successful history could exist without persisted coverage if the browser closed or saving failed | Validate and commit history plus aggregate together on the server                                                         |
| Unversioned aggregate saves                                        | A stale tab could overwrite another tab; saving after deletion could recreate a deleted Testpaq  | Reject stale saves and missing aggregates; carry saved versions through the autosave queue                                |
| Generic upstream errors                                            | Billing failures looked like generic analysis failures                                           | Sanitised billing/quota/auth/model/rate-limit/connection/timeout classification with useful guidance                      |
| Hidden answer input and no completion prompt                       | Users could not naturally answer an open question or refresh with its answer                     | Always-visible answer field; nonblank answer required; refresh offer after the last remaining question                    |
| No output-array/body bounds aligned to domain limits               | Oversized responses or requests could waste resources before validation                          | Bound result collections and API request bodies; reject malformed JSON clearly                                            |
| Provider responses used default remote storage                     | Local-first privacy controls were incomplete                                                     | Set `store: false` on both analysis and access checks                                                                     |
| History/config fetch errors silently ignored                       | Local service failures could appear as empty state                                               | Display configuration/history loading failures                                                                            |
| Nonfunctional mobile create button and mouse-only brand navigation | Small-screen creation/navigation was unreliable                                                  | Visible functional New Testpaq button on mobile and native button for brand navigation                                    |
| Browser-launch failure or invalid port arguments unhandled         | Startup could fail unclearly                                                                     | Validate port; leave a usable URL if opening the browser fails                                                            |

## Recommended follow-up work

1. **Refresh change review.** Show added/changed/retained coverage against the previous analysis, flag accepted scenarios affected by revised requirements, and offer explicit archival for removed scope. v0.2 intentionally keeps reviewed coverage; it cannot safely infer which human decisions should be overwritten.
2. **Backup and restore.** Add a complete workspace export/import including groups, Testpaqs and history, plus a pre-migration backup. Markdown is a handoff brief, not a recoverable backup.
3. **Conflict recovery.** Keep the current local draft and offer a comparison/merge after a stale-tab save conflict. Current conflict protection prevents silent overwrites but leaves reconciliation to the user.
4. **Visible save retry and empty-field validation.** A Retry save control and field-specific validation would make temporary blank fields and failed saves easier to recover from without navigating away. There is no dedicated recovery buffer for unsaved drafts.
5. **Refresh provenance per suggestion.** Link individual scenarios and requirements to the Analysis Run that introduced or changed them, and show the source answer/requirement for newly clarified scope.
6. **Search, archive, duplicate and delete workflows.** The server supports deletion but the UI lacks full lifecycle management. Add a reversible archive and duplication before adding broader test-management integrations.
7. **Single-instance ownership of the database.** Running two separate CLI processes against the same SQLite file needs a launch lock or explicit coordination. The current design assumes one local service and supports multiple tabs through that service.
8. **Export completion semantics.** Mark exported only after a successful clipboard/download handoff; currently saving the exported status precedes the clipboard operation. A clipboard-permission failure can leave the Testpaq marked exported.
9. **Targeted undo.** Review-panel undo snapshots the full aggregate and can restore older unrelated edits if used after other changes. Limit undo to the affected scenarios and invalidate it after subsequent edits to those scenarios.
10. **Hosted collaboration as a separate phase.** Introduce authentication, workspace/project membership, audit controls and secret management before exposing this loopback-only app to team members. Project grouping does not itself provide access control.

## Validation boundaries

Automated tests use mocked OpenAI requests; no real API key, real credit balance or live model generation is exercised. Exact prepaid balance is not implemented: the user-triggered check verifies that the configured model can accept a billable request, and directs users to OpenAI billing for balances. Scenario/question deduplication uses IDs and normalised text; the model can still produce semantic paraphrases requiring human review.

The database migration must retain existing v0.1 aggregates and analysis snapshots. Refresh must not erase accepted/rejected scenarios, human edits, answers or inactive requirements. Changes during an in-flight analysis must return a conflict. Test coverage includes these cases and a simulated persistence failure to verify transaction rollback.

Final checks: 44 tests across 12 files passed, along with lint, TypeScript checking, production build and formatting. A real single-command install/build/start smoke check passed using an isolated database and a dummy key without OpenAI calls. The compiled CLI also found the repository .env when launched from another working directory. Browser visual verification was unavailable because the Chromium download failed; React workflow tests cover answers, refresh, autosave ordering and visible billing guidance.
