# Testpaq technical guide

Testpaq is a local-first QA change-review workbench. Paste a product ticket, make its requirements explicit, review structured QA scenarios, preserve requirement traceability, classify intended coverage, and export a clean Markdown coverage brief.

AI proposes. Humans decide. A scenario always keeps its historically truthful origin: **explicit**, **inferred**, or **human**.

## v0.3 capabilities

- Flexible OpenAI model selection, explicit account-model loading and saved model preference
- Explicit Testpaq completion and reopening; completed coverage stays readable and exportable
- Qase native v2 CSV downloads from reviewed linked test cases, with an inclusion preview
- Cases marked **To be automated** retain that Qase status; other selected cases import as manual

## Existing capabilities

- Persistent project groups, group filtering, renaming and moving existing Testpaqs
- Visible answers on every question, with a refresh offer after all remaining questions are answered
- Refresh analysis using current scope, answers and existing coverage while retaining review decisions and human edits
- Server-side atomic analysis application and conflict protection for multiple browser tabs
- Automatic .env loading, missing-key warnings and a single install/build/run command
- Session-only API key linking, explicit billable-access checks and actionable billing errors
- Local Testpaq, ticket, requirement, scenario, question, and analysis-history management
- Transactional SQLite persistence and automatic text-edit saving
- OpenAI analysis behind a small validated provider boundary
- Explicit/inferred provenance and requirement-to-scenario traceability
- Fast scenario review with filters, bulk actions, keyboard shortcuts, and undo
- Independent Manual, Qase candidate, and Automation candidate intentions
- Question resolution/dismissal, risk visibility, and uncovered-requirement reporting
- Deterministic Markdown preview, copy, and download
- System, light, and dark themes
- Development-only realistic and 200-scenario fixtures

Qase writes, repository inspection, Cypress generation, GitHub/PR analysis, execution evidence, accounts, cloud sync, and collaboration are deliberately outside v0.3.

## Requirements

- Node.js 22 or newer
- npm
- An OpenAI API key only if AI analysis is required; all manual functionality works without one

## Install and run

```bash
cp .env.example .env
# Edit .env to add OPENAI_API_KEY if you want AI analysis.
npm run run
```

The single run command installs dependencies when the lockfile or Node ABI changes, builds the UI/server, loads configuration and starts Testpaq. For future launches, use the same command; no shell sourcing is required.

Testpaq binds to `127.0.0.1`, selects an available port, opens the default browser, and stops cleanly with `Ctrl+C`. To avoid opening the browser:

```bash
npm run run -- --no-open
```

For a shorter launch after a build, use `npm start`. Optional global CLI installation:

```bash
npm link
testpaq
```

For local development, with fixture controls enabled (run `npm install` first):

```bash
npm run dev
```

The UI runs at `http://127.0.0.1:5173`; the API runs at `http://127.0.0.1:4178`.

## AI configuration

Testpaq implements one provider: OpenAI. The server never returns credentials to the browser, persists them in SQLite, places them in URLs or includes them in exports. You can optionally enter a key in the OpenAI connection dialog; it is sent only to the local service, used for an access check, cleared from the form and held in server memory until restart.

```bash
# .env (never commit this file)
OPENAI_API_KEY=your-key
TESTPAQ_OPENAI_MODEL=gpt-5-mini
```

`.env` is loaded before the provider is created, in both development and compiled CLI launches. The working directory's `.env` takes precedence over the repository's `.env`; explicitly exported shell variables take precedence over both. Set `TESTPAQ_ENV_FILE=/absolute/path/.env` to select a specific file. Editing `.env` requires a server restart, but does not require rebuilding. Builds and startup warn when the key is missing or blank, while leaving manual functionality available.

**Check OpenAI** opens an explicit access check using the configured model. It sends only “Reply with OK” in a small billable request. Listing models would only prove authentication, not billable access. The app distinguishes an unchecked key, verified access and errors; it does not claim an exact credit balance. Billing/quota failures include an explanation and [OpenAI API billing](https://platform.openai.com/settings/organization/billing/overview). Invalid keys, model permissions, rate limits, network failures and timeouts receive separate messages. Successful analysis also verifies access. No check is sent automatically at startup.

Before each analysis, Testpaq shows the provider, model, and exact classes of content that will leave the device. Ticket content is framed as untrusted data. The disclosed input includes current questions and their recorded answers, current requirements (including inactive ones) and existing scenarios. Provider output must pass the Zod schema and provenance invariants before any result is added; a malformed response is recorded as a failed Analysis Run and otherwise discarded.

## Local data and privacy

The SQLite database lives at:

- macOS: `~/Library/Application Support/Testpaq/testpaq.db`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/testpaq/testpaq.db`
- Windows: `%LOCALAPPDATA%/Testpaq/testpaq.db`

Set `TESTPAQ_DATA_DIR` to use another directory. Testpaq makes no OpenAI network request until the user confirms an analysis or an API access check. Responses use `store: false`. It does not read repositories, arbitrary files, environment variables other than its documented configuration, or unrelated Testpaqs for analysis.

The production service binds only to loopback. Each launch creates a random session token embedded in the served page (not the URL or logs); mutating API requests require the token and same-origin validation. Imported content is rendered as text, API inputs are validated, SQL is parameterised, and content/AI bodies are not logged.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run format:check
```

## Architecture

```text
testpaq CLI
  └─ Hono localhost service
       ├─ React 19 + Vite browser UI
       ├─ application routes and validation
       ├─ SQLite aggregate store + analysis-run records
       ├─ OpenAI AnalysisProvider adapter
       └─ deterministic Markdown export
```

## Groups, answers and refresh

Create a project group on the Testpaqs page, choose it when creating a Testpaq, or move an existing Testpaq with its Project group selector. Filter by group or Ungrouped; Manage group lets you rename or remove it. Removing a group preserves all its Testpaqs under Ungrouped. v0.1 Testpaqs migrate automatically and initially remain ungrouped.

Write an answer directly under each question, then select **Save answer** to resolve it. A blank answer cannot resolve a question. Answers survive reopening and appear in the Markdown coverage brief and analysis-history snapshot. After the last remaining question is answered, the app offers **Refresh Testpaq**; this opens the normal disclosure dialog before any content is sent.

Update ticket fields, QA context or requirements as needed, then choose **Refresh analysis**. The app saves pending edits first and disables editing during analysis. Refresh reuses matching scenario IDs or titles, updates unreviewed generated proposals, and adds new coverage. It preserves accepted/rejected scenarios, human edits, destinations, requirement provenance and existing answers. It does not automatically delete old coverage or reactivate rejected requirements: review previous scenarios when scope is removed. A changed-scope requirement is added separately rather than rewriting an old one. Matching relies on IDs and normalised text, so semantically equivalent paraphrases may still need manual review.

Changes to ticket scope, requirements or answers show a refresh reminder. New analysis and its history record are committed atomically on the server. Conflicting saves from another tab or changes during analysis are rejected rather than silently overwriting newer data.

The complete Testpaq is stored as a validated aggregate, making autosave and bulk review changes atomic. Analysis runs are separate rows linked by foreign key so a new run cannot erase historical provenance. There is no client state framework, ORM, desktop shell, external database, telemetry, or background service.

## Model selection, completion and Qase CSV

Open the OpenAI connection dialog, enter a model ID or use **Load available models** to populate suggestions, then **Save model**. Saving makes no OpenAI request; loading the account model list is an explicit network request. The selected model is persisted in the local database and takes precedence over `TESTPAQ_OPENAI_MODEL`; the environment value supplies the initial default. API access checks and analyses use the selected model, and history records the model used by each run. Listed models may not support Responses structured output; a successful analysis validates compatibility. See [OpenAI model listing](https://developers.openai.com/api/reference/resources/models/methods/list).

Use **Mark completed** to record that the Testpaq's QA review and handoff work is complete. This is a human decision, independent of downloads, unresolved questions and test execution. Completed Testpaqs disable editing and analysis while retaining scenario expansion, filters, coverage brief, CSV and history access. **Reopen Testpaq** returns to In review and permits changes. Existing v0.1/v0.2 data, groups and analysis history migrate automatically.

Scenario review captures coverage intent. Detailed test cases are separate first-class children with one parent scenario, stable case/step IDs, objective, preconditions/postconditions, ordered action/data/result steps, missing details, review status and destination flags. Parent destinations supply defaults for new cases. Existing payloads without testCases remain valid; they are not silently converted or approved.

In Test cases, add cases manually, explicitly convert a legacy coverage summary into a proposal, or confirm a separate billable AI drafting request. Generated cases start Proposed and retain their run ID. Missing details block acceptance. Editing case content returns it to Proposed. A scope snapshot detects changed ticket fields, parent intent, linked requirements and resolved answers. Acceptance records the reviewed current scope. Archived/rejected parents and cases, proposals, and cases awaiting scope review are excluded from Qase export.

The API uses `/api/test-cases/draft` with saved aggregate version and disclosed model, constructs a selected-scope snapshot server-side and checks for concurrent edits before committing cases and generation history in one transaction. History supports both coverage-analysis and case-generation results. Backups include linked cases and these runs. SQLite user_version 5 prevents earlier builds from opening a workspace containing the new domain data; the payload extension needs no case-table migration.

The Qase CSV uses native v2 (`v2.id`), one record per eligible linked case, with complete ordered actions, results and data. Preconditions/postconditions are included; descriptions preserve ticket, parent/case IDs, provenance, requirements, rationale and risks. Qase or To be automated selections include each case once, mapping to `is-not-automated` or `to-be-automated`. Blank IDs let Qase allocate new IDs; reimporting can create duplicates. CSV generation is deterministic and makes no AI request. See [Qase CSV formatting](https://docs.qase.io/en/articles/14441496-qase-csv-adding-test-steps) and [automation field values](https://docs.qase.io/en/articles/14423241-qase-csv-test-case-properties).

A download prepares a file for manual import; it does not confirm Qase creation or Cypress implementation. Successful browser handoff updates export status after copying or requesting the download; exporting a completed Testpaq preserves Completed. Cypress code generation and direct Qase API writes remain deferred.

## Recovery and workspace ownership

Use Backup / restore in the app to export or restore groups, Testpaqs, analysis runs and saved model preference. API keys are excluded. Restore replaces the workspace transactionally and first creates a SQLite snapshot alongside the database; migrations also snapshot existing databases. Backups contain sensitive ticket content. Keep an external copy to protect against disk loss.

A per-database lock prevents two services from opening one workspace. Dead-process locks recover on the next launch. Browser drafts use localStorage and offer three-way comparison when saved data changes. List and history APIs return paginated results; list search runs across the workspace.
