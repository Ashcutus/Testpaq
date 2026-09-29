import { AlertCircle, Check, ClipboardList, Clock3, Download, FileInput, HelpCircle, ListChecks, LoaderCircle, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppConfig } from "../App";
import { api } from "../lib/api";
import { label } from "../lib/utils";
import { renderMarkdown } from "../shared/export";
import type { AnalysisResult, Testpaq } from "../shared/domain";
import { ExportPanel } from "./panels/ExportPanel";
import { HistoryPanel } from "./panels/HistoryPanel";
import { QuestionsPanel } from "./panels/QuestionsPanel";
import { ReviewPanel } from "./panels/ReviewPanel";
import { TicketPanel } from "./panels/TicketPanel";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";

type Section = "ticket" | "review" | "questions" | "export" | "history";

export function TestpaqWorkbench({ id, config }: { id: string; config?: AppConfig }) {
  const [item, setItem] = useState<Testpaq>();
  const [loadedId, setLoadedId] = useState<string>();
  const [section, setSection] = useState<Section>("ticket");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [error, setError] = useState("");
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [revision, setRevision] = useState(0);
  const itemRef = useRef<Testpaq | undefined>(undefined);
  const revisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const mountedRef = useRef(true);
  const analysisControllerRef = useRef<AbortController | undefined>(undefined);

  const flushSave = useCallback(async (keepalive = false) => {
    const snapshot = itemRef.current;
    const targetRevision = revisionRef.current;
    if (!snapshot || targetRevision <= savedRevisionRef.current) return snapshot;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveState("saving");
    const save = saveChainRef.current.catch(() => undefined).then(() => api.save(snapshot, keepalive));
    saveChainRef.current = save.then(
      () => undefined,
      () => undefined,
    );
    try {
      const saved = await save;
      savedRevisionRef.current = Math.max(savedRevisionRef.current, targetRevision);
      if (revisionRef.current === targetRevision) {
        itemRef.current = saved;
        if (mountedRef.current) {
          setItem(saved);
          setSaveState("saved");
        }
      }
      return saved;
    } catch (reason) {
      if (mountedRef.current) {
        setSaveState("error");
        setError((reason as Error).message);
      }
      throw reason;
    }
  }, []);

  useEffect(() => {
    let active = true;
    mountedRef.current = true;
    void flushSave(true).catch(() => undefined);
    itemRef.current = undefined;
    revisionRef.current = 0;
    savedRevisionRef.current = 0;
    api
      .get(id)
      .then((value) => {
        if (!active) return;
        itemRef.current = value;
        revisionRef.current = 0;
        savedRevisionRef.current = 0;
        setItem(value);
        setRevision(0);
        setLoadedId(id);
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
    };
  }, [id, flushSave]);

  useEffect(() => {
    if (!item || revision === 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void flushSave().catch(() => undefined), 650);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [item, revision, flushSave]);

  useEffect(() => {
    const onPageHide = () => void flushSave(true).catch(() => undefined);
    addEventListener("pagehide", onPageHide);
    return () => {
      mountedRef.current = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      void flushSave(true).catch(() => undefined);
      analysisControllerRef.current?.abort();
      removeEventListener("pagehide", onPageHide);
    };
  }, [flushSave]);

  const update = useCallback((recipe: (current: Testpaq) => Testpaq) => {
    const current = itemRef.current;
    if (!current) return;
    const next = recipe(structuredClone(current));
    if (next.status === "exported") {
      next.status = "in_review";
      delete next.exportedAt;
    }
    itemRef.current = next;
    revisionRef.current += 1;
    setRevision(revisionRef.current);
    setItem(next);
  }, []);
  const exportMarkdown = async () => {
    await flushSave();
    const current = itemRef.current;
    if (!current) return "";
    const exported = structuredClone(current);
    exported.status = "exported";
    exported.exportedAt = new Date().toISOString();
    itemRef.current = exported;
    revisionRef.current += 1;
    const exportRevision = revisionRef.current;
    setRevision(exportRevision);
    setItem(exported);
    let saved: Testpaq | undefined;
    try {
      saved = await flushSave();
    } catch {
      throw new Error("The latest changes could not be saved. Export was cancelled; retry after saving.");
    }
    if (revisionRef.current !== exportRevision) throw new Error("The brief changed while it was being exported. Review it and retry.");
    return renderMarkdown(saved ?? exported);
  };
  const analyse = async () => {
    if (!item) return;
    setAnalysing(true);
    setError("");
    const controller = new AbortController();
    analysisControllerRef.current = controller;
    try {
      const { result } = await api.analyse({ testpaqId: item.id, ticket: item.ticket, requirements: item.requirements }, controller.signal);
      update((current) => applyAnalysis(current, result));
      setAnalysisOpen(false);
      setSection("review");
      setHistoryVersion((value) => value + 1);
    } catch (reason) {
      if ((reason as Error).name !== "AbortError") setError((reason as Error).message);
      setHistoryVersion((value) => value + 1);
    } finally {
      analysisControllerRef.current = undefined;
      setAnalysing(false);
    }
  };
  if (!item || loadedId !== id)
    return (
      <div className="loading-page">
        {error ? (
          <div className="error-banner">
            <AlertCircle size={16} />
            {error}
          </div>
        ) : (
          <>
            <LoaderCircle className="spin" /> Loading Testpaq…
          </>
        )}
      </div>
    );
  const openQuestions = item.questions.filter((question) => question.status === "open").length;
  const tabs: Array<[Section, string, typeof FileInput, number?]> = [
    ["ticket", "Ticket & requirements", FileInput],
    ["review", "Scenario review", ClipboardList, item.scenarios.length],
    ["questions", "Questions", HelpCircle, openQuestions],
    ["export", "Coverage brief", Download],
    ["history", "Analysis history", Clock3],
  ];
  return (
    <div className="workbench">
      <section className="workbench-header">
        <div>
          <div className="context-line">
            <span>{item.ticket.reference || "UNLINKED"}</span>
            <span>·</span>
            <span>{label(item.status)}</span>
          </div>
          <h1>{item.title}</h1>
        </div>
        <div className={`save-state save-${saveState}`}>
          {saveState === "saving" ? (
            <LoaderCircle className="spin" size={14} />
          ) : saveState === "saved" ? (
            <Check size={14} />
          ) : (
            <AlertCircle size={14} />
          )}
          {saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved locally" : "Save failed"}
        </div>
      </section>
      {error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={16} />
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      <div className="workbench-body">
        <nav className="section-nav" aria-label="Testpaq sections">
          {tabs.map(([value, text, Icon, count]) => (
            <button key={value} aria-current={section === value ? "page" : undefined} onClick={() => setSection(value)}>
              <Icon size={16} />
              <span>{text}</span>
              {count !== undefined && <em>{count}</em>}
            </button>
          ))}
        </nav>
        <section className="workbench-content">
          {section === "ticket" && <TicketPanel item={item} update={update} onAnalyse={() => setAnalysisOpen(true)} />}
          {section === "review" && <ReviewPanel item={item} update={update} />}
          {section === "questions" && <QuestionsPanel item={item} update={update} />}
          {section === "export" && <ExportPanel item={item} markdown={renderMarkdown(item)} onExport={exportMarkdown} />}
          {section === "history" && <HistoryPanel testpaqId={item.id} version={historyVersion} />}
        </section>
      </div>
      <Dialog
        open={analysisOpen}
        onOpenChange={(open) => {
          if (open || !analysing) setAnalysisOpen(open);
        }}
        closeDisabled={analysing}
        title="Review data sent for analysis"
        description="Nothing is added until the response passes Testpaq's validation."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                if (analysing) analysisControllerRef.current?.abort();
                setAnalysisOpen(false);
              }}
            >
              {analysing ? "Cancel analysis" : "Cancel"}
            </Button>
            <Button
              onClick={analyse}
              disabled={analysing || !config?.configured}
              icon={analysing ? <LoaderCircle className="spin" size={16} /> : <ListChecks size={16} />}
            >
              {analysing ? "Analysing ticket…" : "Analyse ticket"}
            </Button>
          </>
        }
      >
        <div className="disclosure">
          <div>
            <span>Provider</span>
            <strong>{config?.provider || "OpenAI"}</strong>
          </div>
          <div>
            <span>Model</span>
            <strong>{config?.model || "gpt-5-mini"}</strong>
          </div>
          <div>
            <span>Content</span>
            <strong>Ticket fields and {item.requirements.length} current requirements</strong>
          </div>
        </div>
        <div className="disclosure-preview">
          <h3>Content preview</h3>
          <dl>
            <dt>Title</dt>
            <dd>{item.ticket.title || item.title}</dd>
            <dt>Description</dt>
            <dd>{item.ticket.description || "Not supplied"}</dd>
            <dt>Acceptance criteria</dt>
            <dd>{item.ticket.acceptanceCriteria || "Not supplied"}</dd>
            <dt>QA context</dt>
            <dd>{item.ticket.qaContext || "Not supplied"}</dd>
          </dl>
        </div>
        <p className="privacy-note">
          <Save size={14} /> Your local database, other Testpaqs, credentials and files are not included.
        </p>
        {!config?.configured && (
          <div className="warning-note">
            <AlertCircle size={16} />
            <span>
              OpenAI is not configured. Set <code>OPENAI_API_KEY</code> on the local service, or continue manually.
            </span>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function applyAnalysis(item: Testpaq, result: AnalysisResult): Testpaq {
  const timestamp = new Date().toISOString();
  const requirementMap = new Map<string, string>();
  for (const generated of result.requirements) {
    const existing = item.requirements.find(
      (requirement) => requirement.id === generated.clientId || requirement.text.toLowerCase() === generated.text.toLowerCase(),
    );
    if (existing) requirementMap.set(generated.clientId, existing.id);
    else {
      const id = crypto.randomUUID();
      requirementMap.set(generated.clientId, id);
      item.requirements.push({ id, text: generated.text, source: generated.source, active: true, createdAt: timestamp });
    }
  }
  const scenarioMap = new Map<string, string>();
  for (const generated of result.scenarios) {
    const id = crypto.randomUUID();
    scenarioMap.set(generated.clientId, id);
    item.scenarios.push({
      id,
      title: generated.title,
      expectedOutcome: generated.expectedOutcome,
      origin: generated.origin,
      category: generated.category,
      review: "proposed",
      requirementIds: generated.requirementClientIds
        .map((clientId) => requirementMap.get(clientId))
        .filter((value): value is string => Boolean(value)),
      rationale: generated.rationale,
      risks: generated.risks,
      destinations: { manual: false, qase: false, automation: false },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  for (const generated of result.questions)
    item.questions.push({
      id: crypto.randomUUID(),
      text: generated.text,
      origin: generated.origin,
      status: "open",
      requirementId: generated.requirementClientId ? requirementMap.get(generated.requirementClientId) : undefined,
      scenarioId: generated.scenarioClientId ? scenarioMap.get(generated.scenarioClientId) : undefined,
      createdAt: timestamp,
    });
  item.status = "in_review";
  return item;
}
