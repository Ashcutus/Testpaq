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
