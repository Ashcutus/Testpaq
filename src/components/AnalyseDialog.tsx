import { AlertCircle, ListChecks, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { AppConfig } from "../App";
import { MAX_DRAFT_SCENARIOS, MAX_TEST_CASES, type Testpaq } from "../shared/domain";
import { scopeQuestions } from "../shared/test-cases";
import { coverageNeedingCases, draftableCoverage, updatableCases } from "../shared/workflow";
import { ScopeDisclosure } from "./ScopeDisclosure";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";

export type AnalysisPlan = { coverage: boolean; scenarioIds: string[]; updateCaseIds: string[] };

export function AnalyseDialog(props: DialogProps) {
  // Mounting the body only while open resets the choices each time without an effect.
  return props.open ? <AnalyseDialogBody {...props} /> : null;
}

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: Testpaq;
  config?: AppConfig;
  busy: boolean;
  progress: string;
  error: string;
  billingUrl?: string;
  stale: boolean;
  onRun: (plan: AnalysisPlan) => void;
  onCancel: () => void;
};

function AnalyseDialogBody({ open, onOpenChange, item, config, busy, progress, error, billingUrl, stale, onRun, onCancel }: DialogProps) {
  const coverage = draftableCoverage(item);
  const changed = updatableCases(item);
  const atCapacity = (item.testCases?.length ?? 0) >= MAX_TEST_CASES;
  const activeCases = (id: string) =>
    (item.testCases ?? []).filter(
      (value) => value.scenarioId === id && !value.archived && !value.replacesCaseId && value.review !== "rejected",
    );
  const needed = new Set(coverageNeedingCases(item).map((value) => value.id));
  const wanted = coverage.filter((value) => needed.has(value.id) || changed.some((entry) => entry.scenarioId === value.id));
  const [requirements, setRequirements] = useState(!item.scenarios.length || stale || !coverage.length);
  const [cases, setCases] = useState(
    !atCapacity && Boolean(coverage.length) && Boolean(item.scenarios.length) && !stale && Boolean(wanted.length),
  );
  const [updateChanged, setUpdateChanged] = useState(true);
  const [scenarioIds, setScenarioIds] = useState<Set<string>>(new Set(wanted.slice(0, MAX_DRAFT_SCENARIOS).map((value) => value.id)));
  const chosen = coverage.filter((value) => scenarioIds.has(value.id));
  const updateCaseIds = cases && updateChanged ? changed.filter((value) => scenarioIds.has(value.scenarioId)).map((value) => value.id) : [];
  const canRun = (requirements || (cases && chosen.length > 0)) && Boolean(config?.configured) && !busy;
  const toggle = (id: string, on: boolean) =>
    setScenarioIds((current) => {
      const next = new Set(current);
      if (on && next.size < MAX_DRAFT_SCENARIOS) next.add(id);
      else next.delete(id);
      return next;
    });
  const sent = {
    testpaqId: item.id,
    model: config?.model,
    ticket: item.ticket,
    requirements: item.requirements,
    questions: item.questions,
    scenarios: requirements ? item.scenarios : cases ? chosen : [],
    testCases: cases ? (item.testCases ?? []).filter((value) => scenarioIds.has(value.scenarioId)) : [],
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next || !busy) onOpenChange(next);
      }}
      closeDisabled={busy}
      title="Analyse"
      description="Choose what the AI works on. Nothing runs until you press Analyse; reviewed items and your edits are never overwritten."
      footer={
        <>
          <Button variant="ghost" onClick={() => (busy ? onCancel() : onOpenChange(false))}>
            {busy ? "Cancel" : "Close"}
          </Button>
          <Button
            disabled={!canRun}
            icon={busy ? <LoaderCircle className="spin" size={16} /> : <ListChecks size={16} />}
            onClick={() => onRun({ coverage: requirements, scenarioIds: cases ? chosen.map((value) => value.id) : [], updateCaseIds })}
          >
            {busy ? progress || "Analysing…" : "Analyse"}
          </Button>
        </>
      }
    >
      <div className="disclosure disclosure-pair">
        <div>
          <span>Provider</span>
          <strong>{config?.provider || "OpenAI"}</strong>
        </div>
        <div>
          <span>Model</span>
          <strong>{config?.model || "gpt-5-mini"}</strong>
        </div>
      </div>
      <fieldset className="analyse-options" disabled={busy}>
        <label className="analyse-option">
          <input type="checkbox" checked={requirements} onChange={(event) => setRequirements(event.target.checked)} />
          <span>
            <strong>Requirements, questions &amp; coverage</strong>
            <em>
              From the ticket, answers and your existing coverage. {item.requirements.length} requirements and {item.scenarios.length}{" "}
              coverage suggestions today{stale ? "; the ticket or answers changed since the last analysis" : ""}.
            </em>
          </span>
        </label>
        <label className="analyse-option">
          <input
            type="checkbox"
            checked={cases}
            disabled={!coverage.length || atCapacity}
            onChange={(event) => setCases(event.target.checked)}
          />
          <span>
            <strong>Test cases</strong>
            <em>
              {atCapacity
                ? "The 3,000-case limit is reached. New drafts and update proposals need available space; existing cases can still be edited."
                : coverage.length
                  ? "Draft cases for the approved coverage you tick below in one action. Larger selections use several AI requests."
                  : "Approve coverage first; cases are drafted for approved coverage."}
            </em>
          </span>
        </label>
        {cases && !!coverage.length && (
          <div className="analyse-coverage">
            <div className="analyse-coverage-actions">
              <button
                type="button"
                onClick={() => setScenarioIds(new Set(coverage.slice(0, MAX_DRAFT_SCENARIOS).map((value) => value.id)))}
              >
                Select all
              </button>
              <button type="button" onClick={() => setScenarioIds(new Set())}>
                Select none
              </button>
              <span>
                {chosen.length} selected{coverage.length > MAX_DRAFT_SCENARIOS ? ` · up to ${MAX_DRAFT_SCENARIOS} per analysis` : ""}
              </span>
            </div>
            <ul>
              {coverage.map((value) => {
                const existing = activeCases(value.id).length;
                const stalled = changed.filter((entry) => entry.scenarioId === value.id).length;
                return (
                  <li key={value.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={scenarioIds.has(value.id)}
                        disabled={!scenarioIds.has(value.id) && scenarioIds.size >= MAX_DRAFT_SCENARIOS}
                        onChange={(event) => toggle(value.id, event.target.checked)}
                      />
                      <span>{value.title}</span>
                      <em>
                        {existing ? `${existing} case${existing === 1 ? "" : "s"}` : "No cases"}
                        {stalled ? ` · ${stalled} changed` : ""}
                      </em>
                    </label>
                  </li>
                );
              })}
            </ul>
            {!!changed.length && (
              <label className="analyse-sub-option">
                <input type="checkbox" checked={updateChanged} onChange={(event) => setUpdateChanged(event.target.checked)} />
                <span>
                  Also propose updates for the {updateCaseIds.length} changed-scope case{updateCaseIds.length === 1 ? "" : "s"} in the
                  selected coverage. Proposals sit beside the original until you apply them.
                </span>
              </label>
            )}
          </div>
        )}
      </fieldset>
      {(requirements || cases) && (
        <details className="analyse-sent">
          <summary>Review what will be sent</summary>
          <ScopeDisclosure
            input={{
              ...sent,
              questions: cases && !requirements ? chosen.flatMap((value) => scopeQuestions(item, value)) : sent.questions,
              requirements:
                cases && !requirements
                  ? item.requirements.filter((value) => chosen.some((entry) => entry.requirementIds.includes(value.id)))
                  : sent.requirements,
            }}
          />
        </details>
      )}
      <p className="privacy-note">Your local database, other Testpaqs, credentials and files are not included.</p>
      {error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
          {billingUrl && (
            <a href={billingUrl} target="_blank" rel="noreferrer">
              Open API billing ↗
            </a>
          )}
        </div>
      )}
      {!config?.configured && (
        <div className="warning-note">
          <AlertCircle size={16} />
          <span>
            OpenAI is not configured. Set <code>OPENAI_API_KEY</code> on the local service, or continue manually.
          </span>
        </div>
      )}
    </Dialog>
  );
}
