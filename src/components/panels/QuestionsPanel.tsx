import { CheckCircle2, CircleSlash2, HelpCircle, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { label } from "../../lib/utils";
import type { Question, Testpaq } from "../../shared/domain";
import { activeRequirementNumbers } from "../../shared/export";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";

export function QuestionsPanel({
  item,
  update,
  onRefresh,
}: {
  item: Testpaq;
  update: (recipe: (item: Testpaq) => Testpaq) => void;
  onRefresh?: () => void;
}) {
  const [refreshOpen, setRefreshOpen] = useState(false);
  const requirementNumbers = activeRequirementNumbers(item);
  const [filter, setFilter] = useState<Question["status"] | "all">("open");
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
    if (status === "resolved" && !item.questions.find((value) => value.id === id)?.resolution?.trim()) return;
    const next = item.questions.map((value) => (value.id === id ? { ...value, status } : value));
    const answered = next.filter((value) => value.status !== "dismissed");
    if (status === "resolved" && answered.length && answered.every((value) => value.status === "resolved" && value.resolution?.trim()))
      setRefreshOpen(true);
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
        <Button icon={<Plus size={16} />} onClick={add}>
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
              <textarea
                rows={2}
                maxLength={3000}
                aria-label="Question"
                value={question.text}
                onChange={(event) =>
                  update((draft) => {
                    draft.questions.find((value) => value.id === question.id)!.text = event.target.value;
                    return draft;
                  })
                }
              />
              <label className="field">
                <span>Answer</span>
                <textarea
                  rows={3}
                  maxLength={3000}
                  aria-label={`Answer to: ${question.text}`}
                  value={question.resolution || ""}
                  placeholder="Record the answer or clarification…"
                  onChange={(event) =>
                    update((draft) => {
                      const value = draft.questions.find((value) => value.id === question.id)!;
                      value.resolution = event.target.value;
                      if (value.status === "resolved" && !event.target.value.trim()) {
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
                  <button disabled={!question.resolution?.trim()} onClick={() => setStatus(question.id, "resolved")}>
                    <CheckCircle2 size={15} />
                    Save answer
                  </button>
                  <button onClick={() => setStatus(question.id, "dismissed")}>
                    <CircleSlash2 size={15} />
                    Dismiss
                  </button>
                </>
              ) : (
                <button onClick={() => setStatus(question.id, "open")}>
                  <RotateCcw size={15} />
                  Reopen
                </button>
              )}
            </div>
          </article>
        ))}
        {!visible.length && <div className="inline-empty">No {filter === "all" ? "" : filter} questions.</div>}
      </div>
      <Dialog
        open={refreshOpen}
        onOpenChange={setRefreshOpen}
        title="Questions answered"
        description="All remaining questions have answers. Refresh this Testpaq to include the clarified scope?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRefreshOpen(false)}>
              Later
            </Button>
            <Button
              onClick={() => {
                setRefreshOpen(false);
                onRefresh?.();
              }}
              disabled={!onRefresh}
            >
              Refresh Testpaq
            </Button>
          </>
        }
      >
        <p>Your answers are saved locally. You can review the content sent to OpenAI before confirming the refresh.</p>
      </Dialog>
    </div>
  );
}
