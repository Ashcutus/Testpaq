# Testpaq investigation baseline

The repository was empty when v0.1 implementation began. This file preserves the architectural and product conclusions supplied to the implementation task; it is not a new discovery exercise.

## Product decision

Testpaq is a local-first QA change-review workbench centred on a **Testpaq**: one bounded packet of QA work for a product change. Its differentiator is the reviewed decision trail from product intent to durable coverage—not generic AI test generation.

Testpaq owns source-grounded analysis, human review, provenance, and handoff. Ticketing owns intent; Qase owns canonical reusable cases and execution history; Cypress owns executable test code. Testpaq must not become a ticket tracker, test-management platform, CI runner, or repository IDE.

## v0.1 boundary

v0.1 must support pasted ticket input, editable requirements, opt-in structured AI analysis, explicit/inferred/human scenario provenance, first-class unresolved questions, requirement links, rapid human review, independent destination intentions, local persistence, analysis history, and deterministic Markdown export.

It must not include Qase API integration, repository inspection, Cypress generation, GitHub/PR analysis, exploratory sessions, cloud sync, accounts, collaboration, telemetry, Docker, or Electron. Qase creation is the earliest plausible v0.2 integration after the review model is validated with real use.

## Architecture decision

Use TypeScript end-to-end, React and Vite for the browser UI, a small loopback-only Node/Hono service, and SQLite for local persistence. A `testpaq` CLI owns startup, migrations, browser opening, and clean shutdown. External systems sit behind narrow adapters. One AI provider is sufficient; structured output must pass runtime validation and provenance invariants before entering the active Testpaq.

The service binds only to `127.0.0.1`. Secrets stay server-side and out of SQLite/logs/exports. AI requests include only user-disclosed ticket context. Imported ticket text is untrusted data and cannot provide model instructions.

## Frontend decision

Use React, Vite, Tailwind, selected shadcn/Radix primitives, Lucide, and Zod. Prefer native React state over a global state library. The visual direction is a compact, calm developer instrument: persistent structure, thin separators, dense scenario rows, restrained colour, excellent keyboard operation, intentional light/dark modes, and no dashboard theatre or stereotypical AI decoration.

## Domain and traceability

A Testpaq contains one ticket, requirements, scenarios, first-class questions, and Analysis Runs. Scenario origin (`explicit | inferred | human`), review decision (`proposed | accepted | rejected`), category, and destination intentions are independent dimensions. Explicit scenarios require at least one valid requirement link. Accepting or editing an inferred scenario never changes its origin. “Qase candidate” and “Automation candidate” are intentions, never claims of materialised coverage.

Store the minimum links necessary to answer which requirements have accepted coverage, which remain uncovered, why each scenario exists, which suggestions were inferred, what QA decided, and what remains unresolved. Execution/evidence concepts wait until their capabilities exist.

