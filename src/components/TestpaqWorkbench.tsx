import { AlertCircle, Check, ClipboardList, Clock3, Download, FileInput, HelpCircle, ListChecks, LoaderCircle, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppConfig } from "../App";
import { api, ApiError } from "../lib/api";
import { label } from "../lib/utils";
import { analysisSignature } from "../shared/analysis";
import { renderMarkdown } from "../shared/export";
import type { Testpaq, ProjectGroup } from "../shared/domain";
import { ExportPanel } from "./panels/ExportPanel";
import { HistoryPanel } from "./panels/HistoryPanel";
import { QuestionsPanel } from "./panels/QuestionsPanel";
import { ReviewPanel } from "./panels/ReviewPanel";
import { TicketPanel } from "./panels/TicketPanel";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";

type Section = "ticket" | "review" | "questions" | "export" | "history";

export function TestpaqWorkbench({ id, config, onConfig }: { id: string; config?: AppConfig; onConfig?: (config: AppConfig) => void }) {
  const [item, setItem] = useState<Testpaq>();
  const [loadedId, setLoadedId] = useState<string>();
  const [section, setSection] = useState<Section>("ticket");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [billingUrl, setBillingUrl] = useState<string>();
  const [error, setError] = useState("");
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [revision, setRevision] = useState(0);
  const savedVersionRef = useRef<string | undefined>(undefined);
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
    const save = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        const saved = await api.save({ ...snapshot, updatedAt: savedVersionRef.current || snapshot.updatedAt }, keepalive);
        savedVersionRef.current = saved.updatedAt;
        return saved;
      });
    saveChainRef.current = save.then(
      () => undefined,
      () => undefined,
    );
    try {
      const saved = await save;
      savedRevisionRef.current = Math.max(savedRevisionRef.current, targetRevision);
      if (itemRef.current?.id === saved.id) itemRef.current.updatedAt = saved.updatedAt;
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
      .groups()
      .then((groups) => {
        if (active) setGroups(groups);
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      });
    api
      .get(id)
      .then((value) => {
        if (!active) return;
        savedVersionRef.current = value.updatedAt;
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
    setBillingUrl(undefined);
    const controller = new AbortController();
    analysisControllerRef.current = controller;
    try {
      await flushSave();
      const current = itemRef.current!;
      const { item: refreshed } = await api.analyse(
        {
          testpaqId: current.id,
          ticket: current.ticket,
          requirements: current.requirements,
          questions: current.questions,
          scenarios: current.scenarios,
        },
        controller.signal,
      );
      if (!mountedRef.current || controller.signal.aborted) return;
      itemRef.current = refreshed;
      savedVersionRef.current = refreshed.updatedAt;
      savedRevisionRef.current = revisionRef.current;
      setItem(refreshed);
      setSaveState("saved");
      setAnalysisOpen(false);
      setSection("review");
      setHistoryVersion((value) => value + 1);
    } catch (reason) {
      if ((reason as Error).name !== "AbortError") {
        setError((reason as Error).message);
        if (reason instanceof ApiError) setBillingUrl(reason.billingUrl);
      }
      setHistoryVersion((value) => value + 1);
    } finally {
      analysisControllerRef.current = undefined;
      setAnalysing(false);
      if (mountedRef.current && onConfig)
        void api
          .config()
          .then(onConfig)
          .catch(() => undefined);
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
          {billingUrl && (
            <a href={billingUrl} target="_blank" rel="noreferrer">
              Open API billing ↗
            </a>
          )}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      <label className="field group-assignment">
        <span>Project group</span>
        <select
          disabled={analysing}
          value={item.groupId || ""}
          onChange={(event) =>
            update((draft) => {
              draft.groupId = event.target.value || undefined;
              return draft;
            })
          }
        >
          <option value="">Ungrouped</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </label>
      {item.lastAnalysedSignature && item.lastAnalysedSignature !== analysisSignature(item) && (
        <div className="warning-note">
          Ticket, requirements or answers have changed since analysis. Refresh to review the updated scope.
        </div>
      )}
      <fieldset className="workbench-body" disabled={analysing} inert={analysing}>
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
          {section === "questions" && <QuestionsPanel item={item} update={update} onRefresh={() => setAnalysisOpen(true)} />}
          {section === "export" && <ExportPanel item={item} markdown={renderMarkdown(item)} onExport={exportMarkdown} />}
          {section === "history" && <HistoryPanel testpaqId={item.id} version={historyVersion} />}
        </section>
      </fieldset>
      <Dialog
        open={analysisOpen}
        onOpenChange={(open) => {
          if (open || !analysing) setAnalysisOpen(open);
        }}
        closeDisabled={analysing}
        title={item.lastAnalysedSignature || item.scenarios.length ? "Refresh Testpaq analysis" : "Review data sent for analysis"}
        description="Refresh includes current scope and question answers. Reviewed scenarios and human edits are preserved; suggestions are merged into existing coverage."
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
              {analysing ? "Analysing ticket…" : item.scenarios.length ? "Refresh analysis" : "Analyse ticket"}
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
            <strong>
              Ticket fields, {item.requirements.length} requirements, {item.questions.length} questions/answers and {item.scenarios.length}{" "}
              scenarios
            </strong>
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
            <dt>Requirements</dt>
            <dd>{item.requirements.map((value) => `${value.active ? "Active" : "Inactive"}: ${value.text}`).join("\n") || "None"}</dd>
            <dt>Questions and answers</dt>
            <dd>
              {item.questions.map((value) => `${value.status}: ${value.text} — ${value.resolution || "No answer"}`).join("\n") || "None"}
            </dd>
            <dt>Existing scenarios</dt>
            <dd>{item.scenarios.map((value) => `${value.review}: ${value.title} — ${value.expectedOutcome}`).join("\n") || "None"}</dd>
          </dl>
        </div>
        <p className="privacy-note">
          <Save size={14} /> Your local database, other Testpaqs, credentials and files are not included.
        </p>
        {error && (
          <div className="error-banner" role="alert">
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
    </div>
  );
}
