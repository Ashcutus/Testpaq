import type { AnalysisInput } from "../shared/domain";
export function ScopeDisclosure({ input }: { input: AnalysisInput }) {
  return (
    <section className="scope-disclosure" aria-label="Content to be sent">
      <h3>Review what will be sent</h3>
      <dl>
        <dt>Ticket title</dt>
        <dd>{input.ticket.title || "Not supplied"}</dd>
        <dt>Description</dt>
        <dd className="preserve-lines">{input.ticket.description || "Not supplied"}</dd>
        <dt>Acceptance criteria</dt>
        <dd className="preserve-lines">{input.ticket.acceptanceCriteria || "Not supplied"}</dd>
        <dt>QA context</dt>
        <dd className="preserve-lines">{input.ticket.qaContext || "Not supplied"}</dd>
      </dl>
      <details>
        <summary>Requirements ({input.requirements.length})</summary>
        <ul>
          {input.requirements.map((value) => (
            <li key={value.id}>
              {value.active ? "Active" : "Draft / inactive"}: {value.text || "Unfinished requirement"}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>Questions and feedback ({input.questions?.length ?? 0})</summary>
        <ul>
          {input.questions?.map((value) => (
            <li key={value.id}>
              {value.text || "Unfinished question"} — {value.status}: {value.resolution || "No answer"}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>
          Coverage ({input.scenarios?.length ?? 0}) and existing cases ({input.testCases?.length ?? 0})
        </summary>
        <ul>
          {input.scenarios?.map((value) => (
            <li key={value.id}>
              {value.title}: {value.expectedOutcome}
            </li>
          ))}
        </ul>
        {input.testCases?.map((value) => (
          <article key={value.id}>
            <strong>
              {value.title} ({value.review})
            </strong>
            <p>{value.objective}</p>
            <p>Preconditions: {value.preconditions || "Not supplied"}</p>
            <ol>
              {value.steps.map((step) => (
                <li key={step.id}>
                  {step.action} — data: {step.data || "None"}; expected: {step.expectedResult}
                </li>
              ))}
            </ol>
          </article>
        ))}
      </details>
      <details>
        <summary>Exact request data</summary>
        <pre className="recovery-preview">{JSON.stringify(input, null, 2)}</pre>
      </details>
    </section>
  );
}
