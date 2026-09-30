import { ArchiveX, ListChecks, Plus } from "lucide-react";
import type { Testpaq } from "../../shared/domain";
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
        active: true,
        createdAt: new Date().toISOString(),
      });
      return draft;
    });
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
          <input value={item.ticket.reference} onChange={(event) => ticketField("reference", event.target.value)} placeholder="EM-2841" />
        </label>
        <label className="field">
          <span>Ticket title</span>
          <input value={item.ticket.title} onChange={(event) => ticketField("title", event.target.value)} placeholder="What is changing?" />
        </label>
        <label className="field full">
          <span>Description</span>
          <textarea
            rows={5}
            value={item.ticket.description}
            onChange={(event) => ticketField("description", event.target.value)}
            placeholder="Paste the ticket description…"
          />
        </label>
        <label className="field full">
          <span>Acceptance criteria</span>
          <textarea
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
        <div className="requirement-list">
          {item.requirements.map((requirement, index) => (
            <div className={`requirement-row ${!requirement.active ? "is-inactive" : ""}`} key={requirement.id}>
              <span className="requirement-number">R{index + 1}</span>
              <textarea
                aria-label={`Requirement ${index + 1}`}
                rows={2}
                value={requirement.text}
                onChange={(event) =>
                  update((draft) => {
                    draft.requirements[index].text = event.target.value;
                    return draft;
                  })
                }
              />
              <span className="source-label">{label(requirement.source)}</span>
              <button
                className="icon-button"
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
