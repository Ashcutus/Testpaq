import { isDraftText } from "../../shared/authoring";
import { ArchiveX, ListChecks, Plus } from "lucide-react";
import type { Testpaq } from "../../shared/domain";
import { workflowSummary } from "../../shared/workflow";
import { label } from "../../lib/utils";
import { Button } from "../ui/Button";

export function TicketPanel({
  item,
  update,
  onAnalyse,
}: {
  item: Testpaq;
  update: (recipe: (item: Testpaq) => Testpaq) => void;
  onAnalyse: () => void;
}) {
  const ticketField = (field: keyof Testpaq["ticket"], value: string) =>
    update((draft) => {
      draft.ticket[field] = value;
      if (field === "title" && value.trim()) draft.title = value;
      return draft;
    });
  const addRequirement = () =>
    update((draft) => {
      draft.requirements.push({
        id: crypto.randomUUID(),
        text: "New requirement",
        source: "human",
        active: false,
        createdAt: new Date().toISOString(),
      });
      return draft;
    });
  const gaps = workflowSummary(item).uncovered;
  return (
    <div className="panel-stack">
      <div className="content-heading">
        <div>
          <p className="eyebrow">Source material</p>
          <h2>Ticket & requirements</h2>
          <p>Preserve what Product said before adding suggested coverage.</p>
        </div>
        <Button icon={<ListChecks size={16} />} onClick={onAnalyse}>
          {item.scenarios.length || item.lastAnalysedSignature ? "Refresh analysis" : "Analyse ticket"}
        </Button>
      </div>
      <section className="editor-section ticket-grid">
        <label className="field compact">
          <span>
            Reference <em>Optional</em>
          </span>
          <input
            maxLength={100}
            value={item.ticket.reference}
            onChange={(event) => ticketField("reference", event.target.value)}
            placeholder="EM-2841"
          />
        </label>
        <label className="field">
          <span>Ticket title</span>
          <input
            maxLength={300}
            value={item.ticket.title}
            onChange={(event) => ticketField("title", event.target.value)}
            placeholder="What is changing?"
          />
        </label>
        <label className="field full">
          <span>Description</span>
          <textarea
            maxLength={30000}
            rows={5}
            value={item.ticket.description}
            onChange={(event) => ticketField("description", event.target.value)}
            placeholder="Paste the ticket description…"
          />
        </label>
        <label className="field full">
          <span>Acceptance criteria</span>
          <textarea
            maxLength={30000}
            rows={6}
            value={item.ticket.acceptanceCriteria}
            onChange={(event) => ticketField("acceptanceCriteria", event.target.value)}
            placeholder="Paste the acceptance criteria…"
          />
        </label>
        <label className="field full">
          <span>
            QA context <em>Optional</em>
          </span>
          <textarea
            maxLength={20000}
            rows={3}
            value={item.ticket.qaContext}
            onChange={(event) => ticketField("qaContext", event.target.value)}
            placeholder="Known risks, environments, useful context…"
          />
        </label>
      </section>
      <section className="editor-section">
        <div className="section-heading">
          <div>
            <h3>Requirements</h3>
            <p>Testable assertions grounded in the ticket or added by QA.</p>
          </div>
          <Button variant="secondary" size="sm" icon={<Plus size={15} />} onClick={addRequirement}>
            Add requirement
          </Button>
        </div>
        {!!gaps.length && (
          <div className="warning-note">
            <strong>{gaps.length} requirements need accepted, current coverage</strong>
            <ul>
              {gaps.map((value) => (
                <li key={value.id}>
                  R{item.requirements.indexOf(value) + 1}: {value.text}
                </li>
              ))}
            </ul>
            <Button variant="secondary" onClick={onAnalyse}>
              Suggest coverage for gaps
            </Button>
          </div>
        )}
        <div className="requirement-list">
          {item.requirements.map((requirement, index) => (
            <div className={`requirement-row ${!requirement.active ? "is-inactive" : ""}`} key={requirement.id}>
              <span className="requirement-number">R{index + 1}</span>
              <textarea
                aria-invalid={!requirement.text.trim()}
                aria-label={`Requirement ${index + 1}`}
                maxLength={4000}
                rows={2}
                value={requirement.text}
                onChange={(event) =>
                  update((draft) => {
                    const value = draft.requirements[index];
                    const wasDraft = isDraftText(value.text, "New requirement");
                    value.text = event.target.value;
                    if (isDraftText(value.text, "New requirement")) value.active = false;
                    else if (wasDraft) value.active = true;
                    return draft;
                  })
                }
              />
              {isDraftText(requirement.text, "New requirement") && (
                <span className="attention">Draft requirement: enter testable behaviour to include it in coverage.</span>
              )}
              {!requirement.text.trim() && <span className="attention">Requirement text is required before saving.</span>}
              <span className="source-label">{label(requirement.source)}</span>
              <button
                className="icon-button"
                disabled={isDraftText(requirement.text, "New requirement")}
                aria-label={requirement.active ? "Reject requirement" : "Restore requirement"}
                title={requirement.active ? "Reject requirement" : "Restore requirement"}
                onClick={() =>
                  update((draft) => {
                    draft.requirements[index].active = !draft.requirements[index].active;
                    return draft;
                  })
                }
              >
                <ArchiveX size={16} />
              </button>
            </div>
          ))}
          {!item.requirements.length && <div className="inline-empty">No requirements yet. Add them manually or analyse the ticket.</div>}
        </div>
      </section>
    </div>
  );
}
