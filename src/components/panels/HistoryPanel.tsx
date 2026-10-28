import { AlertCircle, CheckCircle2, Clock3, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { api } from "../../lib/api";
import { formatRelative, label } from "../../lib/utils";
import type { AnalysisRun, CaseBatchResult } from "../../shared/domain";

export function HistoryPanel({ testpaqId, version }: { testpaqId: string; version: number }) {
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  useEffect(() => {
    let active = true;
    api
      .history(testpaqId)
      .then((runs) => {
        if (active) {
          setRuns(runs);
          setHasMore(runs.length === 100);
          setError("");
        }
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [testpaqId, version, retry]);
  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const more = await api.history(testpaqId, runs.length);
      setRuns((previous) => [...previous, ...more]);
      setError("");
      setHasMore(more.length === 100);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };
  return (
    <div className="panel-stack">
      <div className="content-heading">
        <div>
          <p className="eyebrow">Provenance</p>
          <h2>Analysis history</h2>
          <p>What was sent, which model handled it, and whether validation succeeded.</p>
        </div>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <Button
            variant="secondary"
            onClick={() => {
              setLoading(true);
              setRetry((value) => value + 1);
            }}
          >
            Retry history
          </Button>
        </div>
      )}
      {loading && <p role="status">Loading history…</p>}
      <div className="history-list">
        {runs.map((run) => {
          const application = run.result && "application" in run.result ? run.result.application : undefined;
          const partial =
            application &&
            (application.missingUpdateCaseIds.length ||
              application.capacitySkippedNewCases ||
              application.capacitySkippedUpdateCaseIds.length);
          const displayStatus = partial ? "partial" : run.errorCode === "cancelled" ? "cancelled" : run.status;
          return (
            <article className="history-row" key={run.id}>
              <span className={`history-icon history-${displayStatus}`}>
                {displayStatus === "succeeded" ? (
                  <CheckCircle2 size={17} />
                ) : run.status === "failed" || partial ? (
                  <AlertCircle size={17} />
                ) : (
                  <LoaderCircle className="spin" size={17} />
                )}
              </span>
              <div>
                <strong>
                  {run.promptVersion.startsWith("testpaq-test-cases")
                    ? run.inputSnapshot?.targetCaseId
                      ? "Test case update · "
                      : "Test case drafting · "
                    : "Coverage analysis · "}
                  {run.provider} · {run.model}
                </strong>
                <span>{run.disclosure}</span>
                {run.result && (
                  <p>
                    {"testCases" in run.result
                      ? caseRunSummary(run)
                      : `${run.result.requirements.length} requirement suggestions · ${run.result.scenarios.length} coverage suggestions · ${run.result.questions.length} questions returned`}
                  </p>
                )}
                {run.result && "incomplete" in run.result && run.result.incomplete && <ReturnedDrafts drafts={run.result.testCases} />}
                {application &&
                  (application.capacitySkippedNewCases > 0 || application.capacitySkippedUpdateCaseIds.length > 0) &&
                  run.result &&
                  "application" in run.result &&
                  !run.result.incomplete && <ReturnedDrafts drafts={run.result.testCases} />}
                <details>
                  <summary>Run details</summary>
                  <small>
                    {run.promptVersion} · Input {run.inputHash.slice(0, 10)}…
                  </small>
                </details>
                {run.errorCode && <small>Error: {label(run.errorCode)}</small>}
                {run.inputSnapshot && (
                  <details className="history-snapshot">
                    <summary>View exact analysis input</summary>
                    <h4>{run.inputSnapshot.ticket.title || "Ticket"}</h4>
                    <p>{run.inputSnapshot.ticket.description || "No description supplied."}</p>
                    <p>{run.inputSnapshot.ticket.acceptanceCriteria || "No acceptance criteria supplied."}</p>
                    <p>{run.inputSnapshot.ticket.qaContext || "No additional QA context supplied."}</p>
                    {run.inputSnapshot.requirements.length > 0 && (
                      <ol>
                        {run.inputSnapshot.requirements.map((requirement) => (
                          <li key={requirement.id}>{requirement.text}</li>
                        ))}
                      </ol>
                    )}
                    {(run.inputSnapshot.questions?.length ?? 0) > 0 && (
                      <>
                        <h4>Questions and answers</h4>
                        <ul>
                          {run.inputSnapshot.questions!.map((question) => (
                            <li key={question.id}>
                              {question.status}: {question.text} — {question.resolution || "No answer"}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {run.inputSnapshot.testCases && (
                      <>
                        <h4>Existing linked test cases</h4>
                        <ul>
                          {run.inputSnapshot.testCases.map((value) => (
                            <li key={value.id}>
                              {value.review}: {value.title} — {value.steps.length} steps
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {(run.inputSnapshot.scenarios?.length ?? 0) > 0 && (
                      <>
                        <h4>Existing scenarios</h4>
                        <ul>
                          {run.inputSnapshot.scenarios!.map((scenario) => (
                            <li key={scenario.id}>
                              {scenario.review}: {scenario.title} — {scenario.expectedOutcome}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </details>
                )}
              </div>
              <div className="history-time">
                <span className={`status status-${displayStatus}`}>{label(displayStatus)}</span>
                <time>{formatRelative(run.createdAt)}</time>
              </div>
            </article>
          );
        })}
        {!loading && !error && !runs.length && (
          <div className="inline-empty">
            <Clock3 size={20} /> No analysis runs. Manual use remains fully available.
          </div>
        )}
      </div>
      {hasMore && (
        <button className="button button-secondary" disabled={loadingMore} onClick={() => void loadMore()}>
          Load more history
        </button>
      )}
    </div>
  );
}

function ReturnedDrafts({ drafts }: { drafts: CaseBatchResult["testCases"] }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>View returned drafts, including cases not saved</summary>
      {open &&
        drafts.map((value) => (
          <section key={value.clientId}>
            <h4>{value.title}</h4>
            <p>{value.description}</p>
            {value.preconditions && <p>Preconditions: {value.preconditions}</p>}
            <ol>
              {value.steps.map((step, index) => (
                <li key={index}>
                  {step.action}
                  {step.data && <p>Data: {step.data}</p>}
                  <p>Expected: {step.expectedResult}</p>
                </li>
              ))}
            </ol>
          </section>
        ))}
    </details>
  );
}

/** A case run records what was asked for as well as what came back, so partial updates stay visible in history. */
function caseRunSummary(run: AnalysisRun) {
  const returned = run.result && "testCases" in run.result ? run.result.testCases : [];
  if (run.result && "incomplete" in run.result && run.result.incomplete) {
    const { completedChunks, totalChunks } = run.result.incomplete;
    return `${returned.length} returned drafts retained; no cases saved (${completedChunks} of ${totalChunks} AI requests completed)`;
  }
  const application = run.result && "application" in run.result ? run.result.application : undefined;
  if (application) {
    const { added, revised, missingUpdateCaseIds, capacitySkippedNewCases, capacitySkippedUpdateCaseIds } = application;
    return [
      `${added} new cases and ${revised} update proposals saved`,
      ...(missingUpdateCaseIds.length ? [`${missingUpdateCaseIds.length} requested updates not returned`] : []),
      ...(capacitySkippedNewCases || capacitySkippedUpdateCaseIds.length
        ? [
            `3,000-case limit: ${capacitySkippedNewCases} new cases and ${capacitySkippedUpdateCaseIds.length} update proposals not saved; returned drafts retained below`,
          ]
        : []),
    ].join(" · ");
  }
  const requested = run.inputSnapshot?.updateCaseIds ?? [];
  const revisions = new Set(returned.flatMap((value) => ("replacesCaseId" in value && value.replacesCaseId ? [value.replacesCaseId] : [])));
  const updates = requested.length
    ? ` · ${requested.filter((id) => revisions.has(id)).length} of ${requested.length} requested updates returned`
    : "";
  return `${returned.length} case proposals prepared for review${updates}`;
}
