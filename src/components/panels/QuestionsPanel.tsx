import { CheckCircle2, CircleSlash2, HelpCircle, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { label } from "../../lib/utils";
import type { Question, Testpaq } from "../../shared/domain";
import { Button } from "../ui/Button";

export function QuestionsPanel({ item, update }: { item: Testpaq; update: (recipe: (item: Testpaq) => Testpaq) => void }) {
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
  const setStatus = (id: string, status: Question["status"]) =>
    update((draft) => {
      const question = draft.questions.find((value) => value.id === id)!;
      question.status = status;
      question.resolvedAt = status === "resolved" ? new Date().toISOString() : undefined;
      return draft;
    });
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
                    ? `Linked to R${item.requirements.findIndex((value) => value.id === question.requirementId) + 1}`
                    : question.scenarioId
                      ? "Linked to scenario"
                      : "Testpaq-wide"}
                </span>
              </div>
              <textarea
                rows={2}
                value={question.text}
                onChange={(event) =>
                  update((draft) => {
                    draft.questions.find((value) => value.id === question.id)!.text = event.target.value;
                    return draft;
                  })
                }
              />
              {question.status === "resolved" && (
                <input
                  className="resolution-input"
                  aria-label="Resolution"
                  value={question.resolution || ""}
                  placeholder="Resolution…"
                  onChange={(event) =>
                    update((draft) => {
                      draft.questions.find((value) => value.id === question.id)!.resolution = event.target.value;
                      return draft;
                    })
                  }
                />
              )}
            </div>
            <div className="question-actions">
              {question.status === "open" ? (
                <>
                  <button onClick={() => setStatus(question.id, "resolved")}>
                    <CheckCircle2 size={15} />
                    Resolve
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
    </div>
  );
}
