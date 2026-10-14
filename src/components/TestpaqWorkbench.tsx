import { AlertCircle, Check, ClipboardList, Clock3, Download, FileInput, HelpCircle, ListChecks, LoaderCircle, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppConfig } from "../App";
import { api, ApiError } from "../lib/api";
import { ScopeDisclosure } from "./ScopeDisclosure";
import { useRememberedState } from "../lib/remember";
import { ConflictFields, ReadableValue } from "./ConflictFields";
import { workspaceReplaced } from "../lib/workspace";
import { clearDraft, mergeDraft, readDraft, writeDraft } from "../lib/drafts";
import { TestpaqSchema } from "../shared/domain";
import { label } from "../lib/utils";
import { analysisSignature } from "../shared/analysis";
import { renderQaseCsv } from "../shared/qase";
import { workflowSummary } from "../shared/workflow";
import { newTestCase, scopeQuestions } from "../shared/test-cases";
import { renderMarkdown } from "../shared/export";
import type { Testpaq, ProjectGroup } from "../shared/domain";
import { TestCasesPanel } from "./panels/TestCasesPanel";
import { ExportPanel } from "./panels/ExportPanel";
import { HistoryPanel } from "./panels/HistoryPanel";
import { QuestionsPanel } from "./panels/QuestionsPanel";
import { ReviewPanel } from "./panels/ReviewPanel";
import { TicketPanel } from "./panels/TicketPanel";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";

type Section = "ticket" | "review" | "questions" | "cases" | "export" | "history";

export function TestpaqWorkbench({
  id,
  config,
  onConfig,
  registerSave,
  registerDraft,
  onDirtyChange,
}: {
  id: string;
  config?: AppConfig;
  onConfig?: (config: AppConfig) => void;
  registerSave?: (save?: () => Promise<unknown>) => void;
  registerDraft?: (draft?: () => Testpaq | undefined) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [item, setItem] = useState<Testpaq>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadedId, setLoadedId] = useState<string>();
  const [section, setSection] = useRememberedState<Section>(`${id}:section`, "ticket", (value) =>
    ["ticket", "review", "questions", "cases", "export", "history"].includes(String(value)),
  );
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [billingUrl, setBillingUrl] = useState<string>();
  const [error, setError] = useState("");
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [caseDraftOpen, setCaseDraftOpen] = useState(false);
  const [acceptedScenarioId, setAcceptedScenarioId] = useState<string>();
  const [targetCaseId, setTargetCaseId] = useState<string>();
  const [completionOpen, setCompletionOpen] = useState(false);
  const [caseScenarioId, setCaseScenarioId] = useRememberedState<string | undefined>(
    `${id}:coverage`,
    undefined,
    (value) => typeof value === "string",
  );
  const [focusedCaseId, setFocusedCaseId] = useState<string>();
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [conflictChoices, setConflictChoices] = useState<Record<string, "local" | "saved">>({});
  const [recovery, setRecovery] = useState<{ base: Testpaq; local: Testpaq; remote: Testpaq; merged: Testpaq; conflicts: string[] }>();
  const [draftNotice, setDraftNotice] = useState("");
  const baseRef = useRef<Testpaq | undefined>(undefined);
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
    if (workspaceReplaced()) throw new Error("Workspace replaced. Download your retained draft and reload.");
    const snapshot = itemRef.current;
    const targetRevision = revisionRef.current;
    if (!snapshot || targetRevision <= savedRevisionRef.current) return snapshot;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const validation = TestpaqSchema.safeParse(snapshot);
    if (!validation.success) {
      const details = validation.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
      setSaveState("error");
      setError(`Fix these draft fields before saving: ${details}`);
      throw new Error(details);
    }
    setSaveState("saving");
    const save = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        const saved = await api.save({ ...snapshot, updatedAt: savedVersionRef.current || snapshot.updatedAt }, keepalive);
        savedVersionRef.current = saved.updatedAt;
        baseRef.current = saved;
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
          setError("");
          try {
            clearDraft(saved.id);
          } catch {
            /* The saved server copy is authoritative. */
          }
        }
      }
      return saved;
    } catch (reason) {
      if (mountedRef.current) {
        setSaveState("error");
        setError((reason as Error).message);
        if (reason instanceof ApiError && reason.code === "save_conflict" && baseRef.current && itemRef.current) {
          const local = structuredClone(itemRef.current);
          const base = baseRef.current;
          try {
            const remote = await api.get(local.id);
            const merged = mergeDraft(base, local, remote);
            setConflictChoices({});
            setRecovery({ base, local, remote, merged: merged.item, conflicts: merged.conflicts });
          } catch {
            /* Keep the local draft if comparison cannot be loaded. */
          }
        }
      }
      throw reason;
    }
  }, []);

  useEffect(() => {
    registerDraft?.(() => itemRef.current);
    return () => registerDraft?.(undefined);
  }, [registerDraft]);
  useEffect(() => {
    onDirtyChange?.(revisionRef.current > savedRevisionRef.current || analysing);
  }, [revision, saveState, analysing, onDirtyChange]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (revisionRef.current > savedRevisionRef.current || analysisControllerRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const replaced = () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      analysisControllerRef.current?.abort();
    };
    addEventListener("beforeunload", beforeUnload);
    addEventListener("testpaq-workspace-replaced", replaced);
    return () => {
      removeEventListener("beforeunload", beforeUnload);
      removeEventListener("testpaq-workspace-replaced", replaced);
    };
  }, []);
  useEffect(() => {
    registerSave?.(flushSave);
    return () => registerSave?.(undefined);
  }, [registerSave, flushSave]);

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
        baseRef.current = value;
        const draft = readDraft(value.id, value.updatedAt);
        const recovered = draft && draft.base.updatedAt === value.updatedAt && value.status !== "completed";
        itemRef.current = recovered ? draft.draft : value;
        revisionRef.current = recovered ? 1 : 0;
        savedRevisionRef.current = 0;
        setItem(itemRef.current);
        setRevision(revisionRef.current);
        setSaveState(recovered ? "saving" : "saved");
        if (recovered) setDraftNotice("Recovered your unsaved local draft.");
        else if (draft) {
          const merged = mergeDraft(draft.base, draft.draft, value);
          setConflictChoices({});
          setRecovery({ base: draft.base, local: draft.draft, remote: value, merged: merged.item, conflicts: merged.conflicts });
          setDraftNotice("A local draft and the saved Testpaq differ. Compare them before saving.");
        }
        setLoadedId(id);
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
    };
  }, [id, flushSave, loadAttempt]);

  useEffect(() => {
    if (!item || revision === 0 || recovery || saveState === "error") return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void flushSave().catch(() => undefined), 650);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [item, revision, flushSave, recovery, saveState]);

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
    if (!current || current.status === "completed" || current.archived || workspaceReplaced()) return;
    const next = recipe(structuredClone(current));
    if (next.status === "exported") {
      next.status = "in_review";
      delete next.exportedAt;
    }
    itemRef.current = next;
    try {
      if (baseRef.current) writeDraft(baseRef.current, next);
    } catch {
      setDraftNotice("Browser storage is unavailable. Keep this tab open until your changes are saved.");
    }
    revisionRef.current += 1;
    setRevision(revisionRef.current);
    setSaveState("saving");
    setItem(next);
  }, []);
  const prepareExport = async (format: "markdown" | "manual" | "qase") => {
    const saved = await flushSave();
    const current = saved ?? itemRef.current;
    if (!current) throw new Error("Testpaq unavailable.");
    return format === "qase"
      ? renderQaseCsv(current)
      : renderMarkdown(format === "manual" ? { ...current, testCases: workflowSummary(current).manual } : current);
  };
  const recordExport = async () => {
    const current = itemRef.current;
    if (!current || current.archived) return;
    const exported = structuredClone(current);
    if (exported.status !== "completed") exported.status = "exported";
    exported.exportedAt = new Date().toISOString();
    itemRef.current = exported;
    revisionRef.current += 1;
    setRevision(revisionRef.current);
    setItem(exported);
    await flushSave();
  };
  const changeCompletion = async () => {
    setHandoffBusy(true);
    setError("");
    try {
      await flushSave();
      const current = itemRef.current!;
      const draft = structuredClone(current);
      if (draft.status === "completed") {
        draft.status = "in_review";
        delete draft.completedAt;
      } else {
        draft.status = "completed";
        draft.completedAt = new Date().toISOString();
      }
      const saved = await api.save({ ...draft, updatedAt: savedVersionRef.current ?? draft.updatedAt });
      itemRef.current = saved;
      savedVersionRef.current = saved.updatedAt;
      baseRef.current = saved;
      savedRevisionRef.current = revisionRef.current;
      setItem(saved);
      setSaveState("saved");
    } catch (reason) {
      setError((reason as Error).message);
      setSaveState("error");
    } finally {
      setHandoffBusy(false);
    }
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
          model: config?.model,
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
      baseRef.current = refreshed;
      try {
        clearDraft(refreshed.id);
      } catch {
        /* Server copy has been committed. */
      }
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
  const draftCases = async () => {
    if (!item || !caseScenarioId || !config) return;
    setAnalysing(true);
    setError("");
    setBillingUrl(undefined);
    const controller = new AbortController();
    analysisControllerRef.current = controller;
    try {
      await flushSave();
      const current = itemRef.current!;
      const { item: refreshed } = await api.draftCases(
        { testpaqId: current.id, scenarioId: caseScenarioId, targetCaseId, updatedAt: current.updatedAt, model: config.model },
        controller.signal,
      );
      if (!mountedRef.current || controller.signal.aborted) return;
      const added = (refreshed.testCases?.length ?? 0) - (current.testCases?.length ?? 0);
      itemRef.current = refreshed;
      savedVersionRef.current = refreshed.updatedAt;
      baseRef.current = refreshed;
      savedRevisionRef.current = revisionRef.current;
      try {
        clearDraft(refreshed.id);
      } catch {
        /* Server copy committed. */
      }
      setItem(refreshed);
      setSaveState("saved");
      setCaseDraftOpen(false);
      if (added) setFocusedCaseId(refreshed.testCases?.at(-1)?.id);
      setSection("cases");
      setDraftNotice(
        targetCaseId
          ? "Proposed update ready. Compare it with the current case before applying."
          : added
            ? `${added} proposed test cases added. Review each case before exporting.`
            : "No additional test cases were added. Existing cases were retained.",
      );
    } catch (reason) {
      if ((reason as Error).name !== "AbortError") {
        setError((reason as Error).message);
        if (reason instanceof ApiError) setBillingUrl(reason.billingUrl);
      }
    } finally {
      analysisControllerRef.current = undefined;
      setAnalysing(false);
      setHistoryVersion((value) => value + 1);
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
            <Button
              variant="secondary"
              onClick={() => {
                setError("");
                setLoadAttempt((value) => value + 1);
              }}
            >
              Retry loading Testpaq
            </Button>
          </div>
        ) : (
          <>
            <LoaderCircle className="spin" /> Loading Testpaq…
          </>
        )}
      </div>
    );
  const progress = workflowSummary(item);
  const openQuestions = item.questions.filter((question) => question.status === "open").length;
  const tabs: Array<[Section, string, typeof FileInput, number?]> = [
    ["ticket", "Ticket & requirements", FileInput],
    ["review", "Scenario review", ClipboardList, item.scenarios.length],
    ["cases", "Test cases", ListChecks, item.testCases?.length ?? 0],
    ["questions", "Questions", HelpCircle, openQuestions],
    ["export", "Coverage brief & handoff", Download],
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
        <div className="button-group">
          <Button
            variant="secondary"
            disabled={analysing || handoffBusy || Boolean(item.archived)}
            onClick={() => (item.status === "completed" ? void changeCompletion() : setCompletionOpen(true))}
          >
            {item.status === "completed" ? "Reopen Testpaq" : "Mark completed"}
          </Button>
          {saveState === "error" && (
            <Button variant="secondary" disabled={analysing || handoffBusy} onClick={() => void flushSave().catch(() => undefined)}>
              Retry save
            </Button>
          )}
          <div className={`save-state save-${saveState}`} role="status" aria-label="Save status" aria-live="polite">
            {saveState === "saving" ? (
              <LoaderCircle className="spin" size={14} />
            ) : saveState === "saved" ? (
              <Check size={14} />
            ) : (
              <AlertCircle size={14} />
            )}
            {saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved locally" : "Save failed"}
          </div>
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
      {draftNotice && (
        <div className="warning-note" role="status">
          {draftNotice}
          <Button variant="ghost" size="sm" onClick={() => setDraftNotice("")}>
            Dismiss notice
          </Button>
        </div>
      )}
      <label className="field group-assignment">
        <span>Project group</span>
        <select
          disabled={analysing || handoffBusy || item.status === "completed" || item.archived}
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
      {item.reviewNotice && <p className="warning-note">{item.reviewNotice}</p>}
      {item.archived && (
        <p className="warning-note">Archived. Restore this Testpaq from All Testpaqs before editing. Exports remain available.</p>
      )}
      {item.status === "completed" && (
        <p className="warning-note">
          Completed{item.completedAt ? ` on ${item.completedAt.slice(0, 10)}` : ""}. Reopen to change coverage or run analysis. Exports
          remain available.
        </p>
      )}
      {item.lastRefresh && (
        <p className="warning-note">
          Last refresh: {item.lastRefresh.added.length} added · {item.lastRefresh.changed.length} changed ·{" "}
          {item.lastRefresh.retained.length} retained.{" "}
          {item.scenarios.filter((scenario) => scenario.scopeReviewRequired && !scenario.archived).length} accepted scenarios need scope
          review.
        </p>
      )}
      {item.lastAnalysedSignature && item.lastAnalysedSignature !== analysisSignature(item) && (
        <div className="warning-note">
          Ticket, requirements or answers have changed since analysis.
          <Button
            variant="secondary"
            size="sm"
            disabled={item.status === "completed" || analysing || handoffBusy}
            onClick={() => setAnalysisOpen(true)}
          >
            Review coverage updates
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCaseScenarioId(progress.scopeReview[0]?.scenarioId);
              setSection("cases");
            }}
          >
            Review affected cases
          </Button>
        </div>
      )}
      <section className="workflow-summary" aria-label="Review readiness">
        <button onClick={() => setSection("ticket")}>
          <strong>{progress.uncovered.length}</strong> coverage gap{progress.uncovered.length === 1 ? "" : "s"}
        </button>
        <button
          onClick={() => {
            setCaseScenarioId(progress.needsCases[0]?.id);
            setSection("cases");
          }}
        >
          <strong>{progress.needsCases.length}</strong> need cases
        </button>
        <button
          onClick={() => {
            setCaseScenarioId(progress.scopeReview[0]?.scenarioId);
            setSection("cases");
          }}
        >
          <strong>{progress.scopeReview.length}</strong> scope changed
        </button>
        <button
          onClick={() => {
            setCaseScenarioId(progress.proposed[0]?.scenarioId);
            setSection("cases");
          }}
        >
          <strong>{progress.proposed.length}</strong> case{progress.proposed.length === 1 ? "" : "s"} to review
        </button>
        <button onClick={() => setSection("export")}>
          <strong>{progress.manual.length}</strong> Manual ready · <strong>{progress.qase.length}</strong> Qase ready
        </button>
      </section>
      <fieldset className="workbench-body" disabled={analysing || handoffBusy} inert={analysing || handoffBusy}>
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
          {section === "ticket" && (
            <fieldset className="editing-panels" disabled={item.status === "completed" || item.archived}>
              <TicketPanel item={item} update={update} onAnalyse={() => setAnalysisOpen(true)} />
            </fieldset>
          )}
          {section === "review" && (
            <ReviewPanel
              item={item}
              update={update}
              readOnly={item.status === "completed" || Boolean(item.archived)}
              onAccepted={setAcceptedScenarioId}
              selectedScenarioId={caseScenarioId}
              onCases={(id) => {
                setCaseScenarioId(id);
                setSection("cases");
              }}
            />
          )}
          {section === "cases" && (
            <>
              <TestCasesPanel
                item={item}
                update={update}
                selectedScenarioId={caseScenarioId}
                focusedCaseId={focusedCaseId}
                onFocusHandled={() => setFocusedCaseId(undefined)}
                onSelect={setCaseScenarioId}
                onRevisionApplied={() => setDraftNotice("")}
                onReviewCoverage={(id) => {
                  setCaseScenarioId(id);
                  setSection("review");
                }}
                onDraft={(id, targetId) => {
                  setTargetCaseId(targetId);
                  setCaseScenarioId(id);
                  setCaseDraftOpen(true);
                }}
                readOnly={item.status === "completed" || Boolean(item.archived)}
              />
              <ExportPanel
                casesOnly
                item={item}
                markdown=""
                onExport={prepareExport}
                onExported={recordExport}
                onBusyChange={setHandoffBusy}
              />
            </>
          )}
          {section === "questions" && (
            <QuestionsPanel
              item={item}
              update={update}
              onRefresh={() => setAnalysisOpen(true)}
              onReviewCases={(questionId) => {
                setCaseScenarioId(
                  progress.scopeReview.find((value) => {
                    const parent = item.scenarios.find((entry) => entry.id === value.scenarioId);
                    return parent && scopeQuestions(item, parent).some((question) => question.id === questionId);
                  })?.scenarioId ?? progress.scopeReview[0]?.scenarioId,
                );
                setSection("cases");
              }}
              readOnly={item.status === "completed" || Boolean(item.archived)}
            />
          )}
          {section === "export" && (
            <ExportPanel
              item={item}
              markdown={renderMarkdown(item)}
              onExport={prepareExport}
              onExported={recordExport}
              onBusyChange={setHandoffBusy}
            />
          )}
          {section === "history" && <HistoryPanel testpaqId={item.id} version={historyVersion} />}
        </section>
      </fieldset>
      <Dialog
        open={Boolean(acceptedScenarioId)}
        onOpenChange={(open) => {
          if (!open) setAcceptedScenarioId(undefined);
        }}
        title="Coverage accepted — create test cases"
        description="Choose how to turn this suggestion into detailed cases. You can select Manual, Qase or both on each case."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAcceptedScenarioId(undefined)}>
              Create later
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const parent = item.scenarios.find((value) => value.id === acceptedScenarioId);
                if (!parent) return;
                update((draft) => {
                  draft.testCases ??= [];
                  const created = newTestCase(draft, parent);
                  draft.testCases.push(created);
                  setFocusedCaseId(created.id);
                  return draft;
                });
                setDraftNotice("");
                setCaseScenarioId(parent.id);
                setSection("cases");
                setAcceptedScenarioId(undefined);
              }}
              disabled={(item.testCases?.length ?? 0) >= 3000}
            >
              Add manually
            </Button>
            <Button
              onClick={() => {
                setCaseScenarioId(acceptedScenarioId);
                setTargetCaseId(undefined);
                setAcceptedScenarioId(undefined);
                setSection("cases");
                setCaseDraftOpen(true);
              }}
              disabled={!config?.configured || (item.testCases?.length ?? 0) >= 3000}
            >
              Draft with AI
            </Button>
          </>
        }
      >
        <p>{item.scenarios.find((value) => value.id === acceptedScenarioId)?.title}</p>
        <p>AI drafting starts only after you review and confirm the content disclosure.</p>
        {!config?.configured && (
          <p className="warning-note">Connect OpenAI from the top bar to use AI. Manual creation is available now.</p>
        )}
      </Dialog>
      <Dialog
        open={completionOpen}
        onOpenChange={setCompletionOpen}
        title="Complete this review?"
        description="Completion records your decision; it does not mean tests have run or passed."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCompletionOpen(false)}>
              Keep reviewing
            </Button>
            <Button
              disabled={handoffBusy}
              onClick={async () => {
                await changeCompletion();
                setCompletionOpen(false);
              }}
            >
              Complete review
            </Button>
          </>
        }
      >
        <p>
          {progress.uncovered.length} coverage gaps · {progress.needsCases.length} suggestions without cases · {progress.scopeReview.length}{" "}
          cases with changed scope · {progress.proposed.length} proposed cases · {progress.openQuestions.length} open questions.
        </p>
        <p>
          {progress.manual.length} Manual cases and {progress.qase.length} Qase cases ready for handoff. You can reopen later.
        </p>
      </Dialog>
      <Dialog
        open={caseDraftOpen}
        onOpenChange={(open) => {
          if (!analysing) setCaseDraftOpen(open);
        }}
        closeDisabled={analysing}
        title={targetCaseId ? "Suggest an update to this case" : "Draft linked test cases"}
        description={
          targetCaseId
            ? "A billable AI request proposes a revision. Compare it before applying; your existing case stays intact."
            : "A separate billable AI request creates proposals for the selected coverage output. Nothing is exported automatically."
        }
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                if (analysing) analysisControllerRef.current?.abort();
                else setCaseDraftOpen(false);
              }}
            >
              {analysing ? "Cancel drafting" : "Cancel"}
            </Button>
            <Button disabled={analysing || !config?.configured} onClick={() => void draftCases()}>
              {analysing ? "Drafting cases…" : targetCaseId ? "Suggest update" : "Draft test cases"}
            </Button>
          </>
        }
      >
        <div className="disclosure">
          <div>
            <span>Provider</span>
            <strong>{config?.provider ?? "OpenAI"}</strong>
          </div>
          <div>
            <span>Model</span>
            <strong>{config?.model ?? "Not configured"}</strong>
          </div>
        </div>
        <p>
          Content sent: all ticket fields, the selected coverage output, its linked requirements, applicable questions/answers and its
          existing linked test cases. Existing decisions and human edits are retained. No repository or Cypress code is sent or generated.
        </p>
        <ScopeDisclosure
          input={{
            testpaqId: item.id,
            model: config?.model,
            targetCaseId,
            scenarioId: caseScenarioId,
            ticket: item.ticket,
            scenarios: item.scenarios.filter((value) => value.id === caseScenarioId),
            requirements: item.requirements.filter((value) =>
              item.scenarios.find((scenario) => scenario.id === caseScenarioId)?.requirementIds.includes(value.id),
            ),
            questions: item.scenarios.find((value) => value.id === caseScenarioId)
              ? scopeQuestions(
                  item,
                  item.scenarios.find((value) => value.id === caseScenarioId)!,
                )
              : [],
            testCases: (item.testCases ?? []).filter((value) => value.scenarioId === caseScenarioId),
          }}
        />
        {!config?.configured && <p className="warning-note">Connect OpenAI to draft cases, or add them manually.</p>}
        {error && (
          <div className="error-banner" role="alert">
            {error}
            {billingUrl && (
              <a href={billingUrl} target="_blank" rel="noreferrer">
                Open API billing ↗
              </a>
            )}
          </div>
        )}
      </Dialog>
      <Dialog
        open={Boolean(recovery)}
        onOpenChange={(open) => {
          if (!open) setRecovery(undefined);
        }}
        title="Compare local and saved changes"
        description="Your local draft is retained. Review both copies before choosing what to save."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                if (!recovery) return;
                itemRef.current = recovery.remote;
                baseRef.current = recovery.remote;
                savedVersionRef.current = recovery.remote.updatedAt;
                savedRevisionRef.current = revisionRef.current;
                setItem(recovery.remote);
                setSaveState("saved");
                try {
                  clearDraft(id);
                } catch {
                  setDraftNotice("Saved copy loaded. Browser draft storage could not be cleared.");
                }
                setRecovery(undefined);
                setDraftNotice("");
                setError("");
              }}
            >
              Use saved copy
            </Button>
            <Button
              disabled={recovery?.remote.status === "completed" || recovery?.conflicts.some((path) => !conflictChoices[path])}
              onClick={() => {
                if (!recovery) return;
                const resolved = mergeDraft(recovery.base, recovery.local, recovery.remote, conflictChoices).item;
                itemRef.current = resolved;
                baseRef.current = recovery.remote;
                savedVersionRef.current = recovery.remote.updatedAt;
                revisionRef.current += 1;
                setRevision(revisionRef.current);
                setSaveState("saving");
                setItem(resolved);
                setError("");
                try {
                  writeDraft(recovery.remote, resolved);
                } catch {
                  setError("Browser draft storage is unavailable. Keep this tab open until the changes save.");
                }
                setRecovery(undefined);
                setDraftNotice("Your selected changes were merged. Independent edits were preserved.");
              }}
            >
              Apply selected changes
            </Button>
          </>
        }
      >
        {recovery && (
          <>
            <p>
              {recovery.conflicts.length
                ? "Choose a version for each conflicting field. Independent edits are preserved automatically."
                : "Independent edits can be merged without conflicts."}
            </p>
            <ConflictFields
              local={recovery.local}
              remote={recovery.remote}
              conflicts={recovery.conflicts}
              choices={conflictChoices}
              onChoose={(path, side) => setConflictChoices((current) => ({ ...current, [path]: side }))}
            />
            {recovery.remote.status === "completed" && (
              <p>Reopen the saved Testpaq before merging a local draft. You can copy draft text from the comparison below.</p>
            )}
            <details open>
              <summary>Local draft</summary>
              <ReadableValue value={recovery.local} />
            </details>
            <details>
              <summary>Saved copy</summary>
              <ReadableValue value={recovery.remote} />
            </details>
          </>
        )}
      </Dialog>
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
