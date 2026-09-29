# Testpaq

Testpaq is a local-first QA change-review workbench. Paste a product ticket, make its requirements explicit, review structured QA scenarios, preserve requirement traceability, classify intended coverage, and export a clean Markdown coverage brief.

AI proposes. Humans decide. A scenario always keeps its historically truthful origin: **explicit**, **inferred**, or **human**.

## v0.1 capabilities

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

Qase writes, repository inspection, Cypress generation, GitHub/PR analysis, execution evidence, accounts, cloud sync, and collaboration are deliberately outside v0.1.

## Requirements

- Node.js 22 or newer
- npm
- An OpenAI API key only if AI analysis is required; all manual functionality works without one

## Install and run

```bash
npm install
npm run build
npm link
testpaq
```

Testpaq binds to `127.0.0.1`, selects an available port, opens the default browser, and stops cleanly with `Ctrl+C`. To avoid opening the browser:

```bash
testpaq --no-open
```

For local development, with fixture controls enabled:

```bash
npm run dev
```

The UI runs at `http://127.0.0.1:5173`; the API runs at `http://127.0.0.1:4178`.

## AI configuration

Testpaq implements one v0.1 provider: OpenAI. Credentials stay in the Node process and are never sent to browser JavaScript, stored in SQLite, placed in URLs, or included in exports.

```bash
export OPENAI_API_KEY="your-key"
export TESTPAQ_OPENAI_MODEL="gpt-5-mini" # optional
testpaq
```

Before each analysis, Testpaq shows the provider, model, and exact classes of content that will leave the device. Ticket content is framed as untrusted data. Provider output must pass the Zod schema and provenance invariants before any result is added; a malformed response is recorded as a failed Analysis Run and otherwise discarded.

## Local data and privacy

The SQLite database lives at:

- macOS: `~/Library/Application Support/Testpaq/testpaq.db`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/testpaq/testpaq.db`
- Windows: `%LOCALAPPDATA%/Testpaq/testpaq.db`

Set `TESTPAQ_DATA_DIR` to use another directory. Testpaq makes no network request until the user confirms an analysis. It does not read repositories, arbitrary files, environment variables other than its documented configuration, or unrelated Testpaqs for analysis.

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

The complete Testpaq is stored as a validated aggregate, making autosave and bulk review changes atomic. Analysis runs are separate rows linked by foreign key so a new run cannot erase historical provenance. There is no client state framework, ORM, desktop shell, external database, telemetry, or background service.
