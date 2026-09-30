import { AlertCircle, CheckCircle2, Clock3, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { formatRelative, label } from "../../lib/utils";
import type { AnalysisRun } from "../../shared/domain";

export function HistoryPanel({ testpaqId, version }: { testpaqId: string; version: number }) {
  const [error, setError] = useState("");
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  useEffect(() => {
    let active = true;
    api
      .history(testpaqId)
      .then((runs) => {
        if (active) {
          setRuns(runs);
          setError("");
        }
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
    };
  }, [testpaqId, version]);
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
        </div>
      )}
      <div className="history-list">
        {runs.map((run) => {
          const displayStatus = run.errorCode === "cancelled" ? "cancelled" : run.status;
          return (
            <article className="history-row" key={run.id}>
              <span className={`history-icon history-${displayStatus}`}>
                {displayStatus === "succeeded" ? (
                  <CheckCircle2 size={17} />
                ) : run.status === "failed" ? (
                  <AlertCircle size={17} />
                ) : (
                  <LoaderCircle className="spin" size={17} />
                )}
              </span>
              <div>
                <strong>
                  {run.provider} · {run.model}
                </strong>
                <span>{run.disclosure}</span>
                <small>
                  {run.promptVersion} · Input {run.inputHash.slice(0, 10)}…
                </small>
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
        {!runs.length && (
          <div className="inline-empty">
            <Clock3 size={20} /> No analysis runs. Manual use remains fully available.
          </div>
        )}
      </div>
    </div>
  );
}
