# Testpaq

Turn a product ticket into a QA review you can explain and hand off.

Testpaq keeps tickets, requirements, test scenarios and open questions together in a local workspace. AI can propose coverage; you decide what to keep, how to test it and when the review is complete.

## Get started

You need **Node.js 22 or newer** and npm. An OpenAI API key is optional: you can write and review everything manually.

```bash
cp .env.example .env
# Optional: add your OPENAI_API_KEY to .env
npm run run
```

Testpaq installs dependencies, builds and opens in your browser. Use the same command next time. Your work stays in a local SQLite database. Stop the app with `Ctrl+C`; use `npm run run -- --no-open` if you prefer to open the browser yourself.

## A typical review

1. Create a Testpaq and paste your ticket. Organise related work into project groups.
2. Clarify the requirements yourself or choose **Analyse ticket**. Before AI runs, you see the model and what content will be sent.
3. Accept, reject or edit the proposed scenarios. Accepting a suggestion offers **Add manually**, **Draft with AI** or **Create later** straight away. Manual and Qase selections on coverage supply defaults for new cases.
4. Create and review cases with their setup, data, steps and expected results. Select **Manual coverage**, **Qase CSV** or both beside case acceptance. Replace starter text and resolve missing details before accepting.
5. Answer questions and add requirements as scope develops. Review affected cases or refresh coverage from the offered actions. **Suggest case update with AI** proposes a revision beside the original; apply only after comparing, then accept the revised case.
6. Use **Coverage brief & handoff** to download Manual cases or Qase CSV. The readiness strip shows gaps, missing cases and reviews still needed. **Mark completed** shows a summary before closing; **Reopen Testpaq** lets you make changes.

Completion records your review decision. It does not claim tests have run or passed.

## Linked test cases and Qase handoff

Accepting a coverage output agrees that the behaviour needs testing. Accepting its linked cases agrees how to test it. AI-generated cases start as proposals; content edits return an accepted case to Proposed. Changed ticket scope, linked requirements or recorded answers flag cases for review. Existing decisions and human edits survive refresh and additional drafting.

| Test case selection                                          | Handoff                                    |
| ------------------------------------------------------------ | ------------------------------------------ |
| Accepted, current + Manual                                   | Included in the Manual case download       |
| Accepted, current + Qase CSV                                 | Included in Qase CSV as a manual test case |
| Both selections                                              | Included in both handoffs                  |
| Proposed, rejected, archived, stale or an unapplied revision | Excluded                                   |

Historical v0.3 **To be automated** plans are preserved in Qase CSV and shown in its inclusion preview. The Qase checkbox includes those plans; deselecting Qase clears that case's historical automation selection as well. v0.4 offers only Manual and Qase destinations.

New v0.4 cases use Manual/Qase defaults only. An older parent’s automation intention supplies a Qase default, without marking the new case To be automated. Revisions preserve the original case’s destinations.

The parent coverage output must also be accepted, current and unarchived. Existing coverage summaries are preserved; **Convert coverage to draft case** creates a proposal for you to flesh out and review. A coverage summary alone no longer becomes a Qase case.

Inspect the inclusion preview, then choose **Download Qase CSV**. In your Qase project repository, select **Import Data → Qase.io**, upload the file and choose a parent suite. Every selected case becomes one native Qase v2 record with preconditions, postconditions, ordered actions/data/results, requirement references, provenance and stable local IDs.

The CSV creates new cases: importing it twice can create duplicates. **Cypress implementation is outside v0.4.** Testpaq does not generate or execute automation, or write directly to Qase. See [Qase's import format](https://docs.qase.io/en/articles/14441496-qase-csv-adding-test-steps).

You can also copy or download a Markdown coverage brief for a ticket, pull request or review discussion.

Use the workspace list to archive finished work or duplicate a Testpaq for a fresh review. Copies preserve content and links, with coverage and cases returned to Proposed.

## Choose your AI model

Open the OpenAI settings in the top bar. Enter a model ID, or choose **Load available models** for account suggestions, then **Save model**. Your choice survives restarts. Saving is local; loading models contacts OpenAI. Some listed models may not support the structured responses needed for analysis.

**Check access** makes a small billable request. Analysis also uses your API account. Neither happens automatically at startup. A key entered through the dialog stays in server memory until restart; a key in `.env` is available on subsequent launches.

## Keep your work safe

Edits save automatically. If a save fails, use **Retry save**. A browser draft buffer preserves pending edits across reloads and offers a comparison when another tab has changed the same Testpaq. Choose which value to keep for each overlapping field before saving the merged draft. Navigating away saves pending work or offers draft recovery if saving fails.

Use **Backup / restore** to download the complete workspace. Pending edits in this tab must save successfully first. The backup includes groups, Testpaqs, analysis history and model preference. Keep the file somewhere safe: it contains your ticket content, but no API key. Restoring replaces the workspace; the server first creates a local safety snapshot. Other open tabs pause editing after a restore and offer their retained drafts for download. Reload those tabs to use the restored workspace. Database migrations also make a local snapshot, and a second app instance cannot open the same database concurrently.

AI requests send the disclosed ticket, requirements, questions/answers and scenarios to OpenAI. Manual work stays local. Testpaq has no cloud sync or telemetry; OpenAI requests use `store: false`.

## Gallery

These are screenshots of the running app with synthetic example data. No real customer content or external AI calls were used.

### Your workspace

![Project groups and Testpaqs](docs/gallery/projects.png)

### Ticket and requirements

![Ticket with traceable requirements](docs/gallery/ticket.png)

### Review scenarios

![Scenario review with destinations and provenance](docs/gallery/review.png)

### Accept and create

![Accept coverage and immediately choose manual or AI case creation](docs/gallery/accept-create.png)

### Review a proposed update

![Current and proposed case details before applying an update](docs/gallery/case-update.png)

### Detailed test cases

![Several reviewed test cases linked to one coverage output](docs/gallery/test-cases.png)

### Qase export

![Coverage brief and Qase CSV inclusion preview](docs/gallery/qase-export.png)

### Completed review

![Completed Testpaq remains readable](docs/gallery/completed.png)

### Model settings

![Choose an OpenAI model](docs/gallery/model-settings.png)

<details>
<summary>Dark theme and mobile view</summary>

![Ticket in dark theme](docs/gallery/dark-ticket.png)

<img src="docs/gallery/mobile-export.png" alt="Coverage export on a mobile screen" width="390" />

</details>
