import { CheckCircle2, CircleSlash2, HelpCircle, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { isDraftText } from "../../shared/authoring";
import { label } from "../../lib/utils";
import type { Question, Testpaq } from "../../shared/domain";
import { activeRequirementNumbers } from "../../shared/export";
import { useRememberedState } from "../../lib/remember";
import { Button } from "../ui/Button";

export function QuestionsPanel({
  item,
  update,
  onRefresh,
  onReviewCases,
  readOnly = false,
}: {
  item: Testpaq;
  update: (recipe: (item: Testpaq) => Testpaq) => void;
  onRefresh?: () => void;
  onReviewCases?: (questionId?: string) => void;
  readOnly?: boolean;
}) {
  const [refreshOpen, setRefreshOpen] = useState(false);
  const [answeredId, setAnsweredId] = useState<string>();
  const requirementNumbers = activeRequirementNumbers(item);
  const [filter, setFilter] = useRememberedState<Question["status"] | "all">(`${item.id}:questions-filter`, "open", (value) =>
    ["all", "open", "resolved", "dismissed"].includes(String(value)),
  );
  const visible = item.questions.filter((question) => filter === "all" || question.status === filter);
  const add = () =>
    update((draft) => {
      draft.questions.push({
        id: crypto.randomUUID(),
        text: "New QA question",
        origin: "human",
        status: "open",
        createdAt: new Date().toISOString(),
      });
      return draft;
    });
  const setStatus = (id: string, status: Question["status"]) => {
    if (
      status === "resolved" &&
      (!item.questions.find((value) => value.id === id)?.resolution?.trim() ||
        isDraftText(item.questions.find((value) => value.id === id)!.text, "New QA question"))
    )
      return;
    if (status === "resolved") {
      setRefreshOpen(true);
      setAnsweredId(id);
    }
    update((draft) => {
      const question = draft.questions.find((value) => value.id === id)!;
      question.status = status;
      question.resolvedAt = status === "resolved" ? new Date().toISOString() : undefined;
      return draft;
    });
  };
  return (
    <div className="panel-stack">
      <div className="content-heading">
        <div>
          <p className="eyebrow">Ambiguity</p>
          <h2>Questions</h2>
          <p>Keep unknowns visible. Resolving a question never silently creates a requirement.</p>
        </div>
        <Button disabled={readOnly} icon={<Plus size={16} />} onClick={add}>
          Add question
        </Button>
      </div>
      <div className="filter-bar">
        {(["open", "resolved", "dismissed", "all"] as const).map((value) => (
          <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {label(value)}{" "}
            <span>{value === "all" ? item.questions.length : item.questions.filter((question) => question.status === value).length}</span>
          </button>
        ))}
      </div>
      <div className="question-list">
        {visible.map((question) => (
          <article className="question-row" key={question.id}>
            <div className="question-icon">
              <HelpCircle size={18} />
            </div>
            <div className="question-content">
              <div className="meta-line">
                <span className={`origin origin-${question.origin}`}>{label(question.origin)}</span>
                <span>
                  {question.requirementId
                    ? requirementNumbers.has(question.requirementId)
                      ? `Linked to R${requirementNumbers.get(question.requirementId)}`
                      : "Linked to inactive requirement"
                    : question.scenarioId
                      ? "Linked to scenario"
                      : "Testpaq-wide"}
                </span>
              </div>
              <label className="field">
                <span>Question scope</span>
                <select
                  aria-label={`Scope for: ${question.text}`}
                  disabled={readOnly}
                  value={
                    question.scenarioId
                      ? `scenario:${question.scenarioId}`
                      : question.requirementId
                        ? `requirement:${question.requirementId}`
                        : "global"
                  }
                  onChange={(event) =>
                    update((draft) => {
                      const value = draft.questions.find((entry) => entry.id === question.id)!;
                      delete value.scenarioId;
                      delete value.requirementId;
                      const [kind, id] = event.target.value.split(":");
                      if (kind === "scenario") value.scenarioId = id;
                      if (kind === "requirement") value.requirementId = id;
                      return draft;
                    })
                  }
                >
                  <option value="global">Whole Testpaq</option>
                  {item.requirements
                    .filter((value) => value.active)
                    .map((value) => (
                      <option key={value.id} value={`requirement:${value.id}`}>
                        R{requirementNumbers.get(value.id)}: {value.text}
                      </option>
                    ))}
                  {item.scenarios
                    .filter((value) => !value.archived)
                    .map((value) => (
                      <option key={value.id} value={`scenario:${value.id}`}>
                        {value.title}
                      </option>
                    ))}
                </select>
              </label>
              <textarea
                readOnly={readOnly}
                rows={2}
                maxLength={3000}
                aria-invalid={!question.text.trim()}
                aria-label="Question"
                value={question.text}
                onChange={(event) =>
                  update((draft) => {
                    const value = draft.questions.find((value) => value.id === question.id)!;
                    value.text = event.target.value;
                    if (value.status === "resolved") {
                      value.status = "open";
                      delete value.resolvedAt;
                    }
                    return draft;
                  })
                }
              />
              {!question.text.trim() && <span className="attention">Question text is required before saving.</span>}
              <label className="field">
                <span>Answer</span>
                <textarea
                  readOnly={readOnly}
                  rows={3}
                  maxLength={3000}
                  aria-label={`Answer to: ${question.text}`}
                  value={question.resolution || ""}
                  placeholder="Record the answer or clarification…"
                  onChange={(event) =>
                    update((draft) => {
                      const value = draft.questions.find((value) => value.id === question.id)!;
                      value.resolution = event.target.value;
                      if (value.status === "resolved") {
                        value.status = "open";
                        delete value.resolvedAt;
                      }
                      return draft;
                    })
                  }
                />
              </label>
            </div>
            <div className="question-actions">
              {question.status === "open" ? (
                <>
                  <button
                    disabled={readOnly || !question.resolution?.trim() || isDraftText(question.text, "New QA question")}
                    onClick={() => setStatus(question.id, "resolved")}
                  >
                    <CheckCircle2 size={15} />
                    Save answer
                  </button>
                  <button disabled={readOnly} onClick={() => setStatus(question.id, "dismissed")}>
                    <CircleSlash2 size={15} />
                    Dismiss
                  </button>
                </>
              ) : (
                <button disabled={readOnly} onClick={() => setStatus(question.id, "open")}>
                  <RotateCcw size={15} />
                  Reopen
                </button>
              )}
            </div>
          </article>
        ))}
        {!visible.length && <div className="inline-empty">No {filter === "all" ? "" : filter} questions.</div>}
      </div>
      {refreshOpen && (
        <section className="feedback-actions" aria-label="Question feedback actions" role="status">
          <h3>Questions answered</h3>
          <p>This feedback may change coverage or linked cases. Review the affected scope when ready.</p>
          <div className="button-group">
            <Button variant="ghost" onClick={() => setRefreshOpen(false)}>
              Later
            </Button>
            {onReviewCases && (
              <Button
                variant="secondary"
                onClick={() => {
                  setRefreshOpen(false);
                  onReviewCases(answeredId);
                }}
              >
                Review affected cases
              </Button>
            )}
            <Button
              disabled={!onRefresh}
              onClick={() => {
                setRefreshOpen(false);
                onRefresh?.();
              }}
            >
              Refresh Testpaq
            </Button>
          </div>
          <p>Your answers are saved locally. AI refresh still requires confirmation.</p>
        </section>
      )}
    </div>
  );
}
