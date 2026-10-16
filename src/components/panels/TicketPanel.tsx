import { useState } from "react";
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
  view = "all",
}: {
  item: Testpaq;
  update: (recipe: (item: Testpaq) => Testpaq) => void;
  onAnalyse: () => void;
  view?: "all" | "ticket" | "requirements";
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectedRequirements = item.requirements.filter((value) => selected.has(value.id));
  const decide = (active: boolean) =>
    update((draft) => {
      for (const requirement of draft.requirements) {
        if (selected.has(requirement.id) && (!active || !isDraftText(requirement.text, "New requirement"))) requirement.active = active;
      }
      return draft;
    });
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
          <p className="eyebrow">{view === "requirements" ? "Step 2 · Understand the scope" : "Step 1 · Initial ticket analysis"}</p>
          <h2>{view === "requirements" ? "Requirements overview" : "Start with your ticket"}</h2>
          <p>
            {view === "requirements"
              ? "Choose the requirements in scope, then resolve the questions below."
              : "Paste the source ticket and analyse it to propose requirements, questions and coverage."}
          </p>
        </div>
        <Button icon={<ListChecks size={16} />} onClick={onAnalyse}>
          {item.scenarios.length || item.lastAnalysedSignature ? "Refresh analysis" : "Analyse ticket"}
        </Button>
      </div>
      {view !== "requirements" && (
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
      )}
      {view !== "ticket" && (
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
          {!!item.requirements.length && (
            <div className="selection-toolbar" role="group" aria-label="Requirement selection">
              <label>
                <input
                  type="checkbox"
                  aria-label="Select all requirements"
                  checked={item.requirements.every((value) => selected.has(value.id))}
                  ref={(node) => {
                    if (node)
                      node.indeterminate = selectedRequirements.length > 0 && selectedRequirements.length < item.requirements.length;
                  }}
                  onChange={(event) => setSelected(event.target.checked ? new Set(item.requirements.map((value) => value.id)) : new Set())}
                />{" "}
                Select all
              </label>
              <span>
                {selectedRequirements.length
                  ? `${selectedRequirements.length} selected`
                  : `${item.requirements.filter((value) => value.active).length} in scope`}
              </span>
              <Button
                size="sm"
                disabled={!selectedRequirements.length || selectedRequirements.some((value) => isDraftText(value.text, "New requirement"))}
                onClick={() => decide(true)}
              >
                Approve selected requirements
              </Button>
              <Button size="sm" variant="secondary" disabled={!selectedRequirements.length} onClick={() => decide(false)}>
                Decline selected requirements
              </Button>
            </div>
          )}
          {!!gaps.length && (
            <details className="coverage-details">
              <summary>
                {gaps.length} {gaps.length === 1 ? "requirement needs" : "requirements need"} accepted, current coverage
              </summary>
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
            </details>
          )}
          <div className="requirement-list">
            {item.requirements.map((requirement, index) => (
              <div className={`requirement-row ${!requirement.active ? "is-inactive" : ""}`} key={requirement.id}>
                <label className="requirement-number">
                  <input
                    type="checkbox"
                    aria-label={`Select requirement ${index + 1}`}
                    checked={selected.has(requirement.id)}
                    onChange={(event) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(requirement.id);
                        else next.delete(requirement.id);
                        return next;
                      })
                    }
                  />{" "}
                  R{index + 1}
                </label>
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
      )}
    </div>
  );
}
