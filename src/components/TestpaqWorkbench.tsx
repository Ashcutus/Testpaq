import { AlertCircle, Check, ClipboardList, Clock3, Download, FileInput, ListChecks, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppConfig } from "../App";
import { api, ApiError } from "../lib/api";
import { AnalyseDialog, type AnalysisPlan } from "./AnalyseDialog";
import { useRememberedState } from "../lib/remember";
import { ConflictFields, ReadableValue } from "./ConflictFields";
import { workspaceReplaced } from "../lib/workspace";
import { clearDraft, mergeDraft, readDraft, writeDraft } from "../lib/drafts";
import { TestpaqSchema } from "../shared/domain";
import { label } from "../lib/utils";
import { analysisSignature } from "../shared/analysis";
import { renderQaseCsv } from "../shared/qase";
import { workflowSummary } from "../shared/workflow";
import { renderManualCases, renderMarkdown } from "../shared/export";
import type { Testpaq, ProjectGroup } from "../shared/domain";
import { TestCasesPanel } from "./panels/TestCasesPanel";
import { ExportPanel } from "./panels/ExportPanel";
import { HistoryPanel } from "./panels/HistoryPanel";
import { QuestionsPanel } from "./panels/QuestionsPanel";
import { ReviewPanel } from "./panels/ReviewPanel";
import { TicketPanel } from "./panels/TicketPanel";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";

type Section = "ticket" | "overview" | "review" | "questions" | "cases" | "export" | "history";

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
    ["ticket", "overview", "review", "questions", "cases", "export", "history"].includes(String(value)),
  );
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [billingUrl, setBillingUrl] = useState<string>();
  const [error, setError] = useState("");
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisNotice, setAnalysisNotice] = useState("");
  const [analysisProgress, setAnalysisProgress] = useState("");
  const [completionOpen, setCompletionOpen] = useState(false);
  const [caseScenarioId, setCaseScenarioId] = useRememberedState<string | undefined>(
    `${id}:coverage`,
    undefined,
    (value) => typeof value === "string",
  );
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
        const saved = await api.save({ ...snapshot, updatedAt: savedVersionRef.current || snapshot.updatedAt }, keepalive, baseRef.current);
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
      : format === "manual"
        ? renderManualCases(workflowSummary(current).manual)
        : renderMarkdown(current);
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
      const saved = await api.save({ ...draft, updatedAt: savedVersionRef.current ?? draft.updatedAt }, false, baseRef.current);
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
  const adopt = (refreshed: Testpaq) => {
    itemRef.current = refreshed;
    savedVersionRef.current = refreshed.updatedAt;
    baseRef.current = refreshed;
    savedRevisionRef.current = revisionRef.current;
    try {
      clearDraft(refreshed.id);
    } catch {
      /* Server copy has been committed. */
    }
    setItem(refreshed);
    setSaveState("saved");
  };
  /** One user action: optional ticket analysis, then one batched case request. Never navigates or prompts further. */
  const runAnalysis = async (plan: AnalysisPlan) => {
    if (!item || !config) return;
    setAnalysing(true);
    setError("");
    setBillingUrl(undefined);
    setAnalysisNotice("");
    const controller = new AbortController();
    analysisControllerRef.current = controller;
    const summary: string[] = [];
    let partial = false;
    try {
      await flushSave();
      if (plan.coverage) {
        setAnalysisProgress("Analysing ticket…");
        const before = itemRef.current!;
        const { item: refreshed } = await api.analyse(
          {
            testpaqId: before.id,
            model: config.model,
            ticket: before.ticket,
            requirements: before.requirements,
            questions: before.questions,
            scenarios: before.scenarios,
          },
          controller.signal,
        );
        if (!mountedRef.current || controller.signal.aborted) return;
        adopt(refreshed);
        summary.push(
          `${refreshed.requirements.length - before.requirements.length} requirements, ${refreshed.scenarios.length - before.scenarios.length} coverage suggestions and ${refreshed.questions.length - before.questions.length} questions added`,
        );
      }
      const current = itemRef.current!;
      // Analysis can flag accepted coverage for re-review; only draft for what is still current.
      const scenarioIds = plan.scenarioIds.filter((id) =>
        current.scenarios.some((value) => value.id === id && value.review === "accepted" && !value.archived && !value.scopeReviewRequired),
      );
      const skippedCoverage = plan.scenarioIds.length - scenarioIds.length;
      if (skippedCoverage) {
        partial = true;
        summary.push(
          `Case drafting skipped for ${skippedCoverage} selected coverage output${skippedCoverage === 1 ? "" : "s"} needing scope review. Review and approve that coverage before choosing Analyse again`,
        );
      }
      const updateCaseIds = plan.updateCaseIds.filter((id) =>
        (current.testCases ?? []).some((value) => value.id === id && scenarioIds.includes(value.scenarioId)),
      );
      if (scenarioIds.length) {
        setAnalysisProgress("Drafting test cases…");
        const drafted = await api.draftCases(
          { testpaqId: current.id, scenarioIds, updateCaseIds, updatedAt: current.updatedAt, model: config.model },
          controller.signal,
        );
        if (!mountedRef.current || controller.signal.aborted) return;
        adopt(drafted.item);
        const missing = drafted.missingUpdateCaseIds?.length ?? 0;
        const skippedNew = drafted.capacitySkippedNewCases ?? 0;
        const skippedUpdates = drafted.capacitySkippedUpdateCaseIds?.length ?? 0;
        partial ||= Boolean(missing || skippedNew || skippedUpdates);
        summary.push(
          `${drafted.added ?? 0} test case${drafted.added === 1 ? "" : "s"} drafted${drafted.revised ? ` and ${drafted.revised} update${drafted.revised === 1 ? "" : "s"} proposed` : ""}`,
        );
        // A requested update the model did not return is reported, not counted as success.
        if (missing)
          summary.push(
            `${missing} requested update${missing === 1 ? " was" : "s were"} not returned, so no proposal was made for ${missing === 1 ? "it" : "them"}`,
          );
        if (skippedNew || skippedUpdates)
          summary.push(
            `The 3,000-case limit prevented saving ${skippedNew} new case${skippedNew === 1 ? "" : "s"} and ${skippedUpdates} update proposal${skippedUpdates === 1 ? "" : "s"}. The returned drafts remain in analysis history`,
          );
      }
      setAnalysisOpen(false);
      setAnalysisNotice(
        `${partial ? "Analysis partly finished" : "Analysis finished"}: ${summary.join("; ") || "nothing to do"}. Everything new is a proposal for you to review.`,
      );
    } catch (reason) {
      if ((reason as Error).name !== "AbortError") {
        setError((reason as Error).message);
        if (reason instanceof ApiError) setBillingUrl(reason.billingUrl);
      }
      if (summary.length) setAnalysisNotice(`Partly finished: ${summary.join("; ")}.`);
    } finally {
      analysisControllerRef.current = undefined;
      setAnalysing(false);
      setAnalysisProgress("");
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
  const stale = Boolean(item.lastAnalysedSignature && item.lastAnalysedSignature !== analysisSignature(item));
  const openQuestions = item.questions.filter((question) => question.status === "open").length;
  const tabs: Array<[Section, string, typeof FileInput, number?]> = [
    ["ticket", "Initial ticket analysis", FileInput],
    ["overview", "Requirements & questions", ListChecks, openQuestions],
    ["review", "Coverage approval", ClipboardList, item.scenarios.length],
    ["cases", "Test cases", ListChecks, item.testCases?.length ?? 0],
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
        <div className="button-group">
          <Button
            icon={<ListChecks size={16} />}
            disabled={analysing || handoffBusy || item.status === "completed" || Boolean(item.archived)}
            onClick={() => setAnalysisOpen(true)}
          >
            Analyse
            {stale && (
              <span
                className="stale-dot"
                role="img"
                aria-label="Out of date since last analysis"
                title="Ticket, requirements or answers changed since the last analysis"
              />
            )}
          </Button>
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
      {analysisNotice && (
        <div className="info-note" role="status">
          {analysisNotice}
          <Button variant="ghost" size="sm" onClick={() => setAnalysisNotice("")}>
            Dismiss
          </Button>
        </div>
      )}
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
      <section className="status-strip" aria-label="Review readiness">
        <button onClick={() => setSection("overview")}>
          <strong>{progress.uncovered.length}</strong> coverage gap{progress.uncovered.length === 1 ? "" : "s"}
        </button>
        <button
          onClick={() => {
            setCaseScenarioId(undefined);
            setSection("cases");
          }}
        >
          <strong>{progress.needsCases.length}</strong> need cases
        </button>
        <button
          onClick={() => {
            setCaseScenarioId(undefined);
            setSection("cases");
          }}
        >
          <strong>{progress.scopeReview.length}</strong> scope changed
        </button>
        <button
          onClick={() => {
            setCaseScenarioId(undefined);
            setSection("cases");
          }}
        >
          <strong>{progress.proposed.length}</strong> to review
        </button>
        <button onClick={() => setSection("export")}>
          <strong>{progress.manual.length}</strong> Manual · <strong>{progress.qase.length}</strong> Qase ready
        </button>
        {item.lastRefresh && (
          <span className="status-note">
            Last analysis {item.lastRefresh.at.slice(0, 10)}: {item.lastRefresh.added.length} added · {item.lastRefresh.changed.length}{" "}
            changed
          </span>
        )}
        {stale && <span className="status-note status-stale">Out of date since last analysis</span>}
      </section>
      <fieldset className="workbench-body" disabled={analysing || handoffBusy} inert={analysing || handoffBusy}>
        <nav className="section-nav" aria-label="Testpaq sections">
          {tabs.map(([value, text, Icon, count]) => (
            <button
              key={value}
              aria-current={section === value || (section === "questions" && value === "overview") ? "page" : undefined}
              onClick={() => {
                // Entering Test cases from the tabs shows every case; per-coverage links set their own filter.
                if (value === "cases") setCaseScenarioId(undefined);
                setSection(value);
              }}
            >
              {value === "history" ? (
                <Icon size={16} />
              ) : (
                <span className="stage-number" aria-hidden="true">
                  {tabs.findIndex(([key]) => key === value) + 1}
                </span>
              )}
              <span>{text}</span>
              {count !== undefined && <em aria-hidden="true">{count}</em>}
            </button>
          ))}
        </nav>
        <section className="workbench-content">
          {section === "ticket" && (
            <fieldset className="editing-panels" disabled={item.status === "completed" || item.archived}>
              <TicketPanel view="ticket" item={item} update={update} />
            </fieldset>
          )}
          {section === "review" && (
            <ReviewPanel
              item={item}
              update={update}
              readOnly={item.status === "completed" || Boolean(item.archived)}
              selectedScenarioId={caseScenarioId}
              onCases={(id) => {
                setCaseScenarioId(id);
                setSection("cases");
              }}
            />
          )}
          {section === "cases" && (
            <TestCasesPanel
              item={item}
              update={update}
              selectedScenarioId={caseScenarioId}
              onSelect={setCaseScenarioId}
              onRevisionApplied={() => setDraftNotice("")}
              onReviewCoverage={(id) => {
                setCaseScenarioId(id);
                setSection("review");
              }}
              readOnly={item.status === "completed" || Boolean(item.archived)}
            />
          )}
          {(section === "overview" || section === "questions") && (
            <>
              <fieldset className="editing-panels" disabled={item.status === "completed" || item.archived}>
                <TicketPanel view="requirements" item={item} update={update} />
              </fieldset>

              <QuestionsPanel item={item} update={update} readOnly={item.status === "completed" || Boolean(item.archived)} />
            </>
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
          {!["export", "history"].includes(section) && (
            <div className="stage-footer">
              <span>
                {section === "ticket"
                  ? "Next: confirm the requirements and answer open questions."
                  : section === "overview" || section === "questions"
                    ? "Next: approve or decline the proposed coverage."
                    : section === "review"
                      ? "Next: write and review cases for approved coverage."
                      : "Next: review inclusion and download your handoff."}
              </span>
              <Button
                variant="secondary"
                onClick={() => {
                  if (section === "review") setCaseScenarioId(undefined);
                  setSection(
                    section === "ticket"
                      ? "overview"
                      : section === "overview" || section === "questions"
                        ? "review"
                        : section === "review"
                          ? "cases"
                          : "export",
                  );
                }}
              >
                {section === "ticket"
                  ? "Review requirements"
                  : section === "overview" || section === "questions"
                    ? "Review coverage"
                    : section === "review"
                      ? "Continue to test cases"
                      : "Continue to handoff"}
              </Button>
            </div>
          )}
        </section>
      </fieldset>
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
      <AnalyseDialog
        open={analysisOpen}
        onOpenChange={setAnalysisOpen}
        item={item}
        config={config}
        busy={analysing}
        progress={analysisProgress}
        error={error}
        billingUrl={billingUrl}
        stale={stale}
        onRun={(plan) => void runAnalysis(plan)}
        onCancel={() => analysisControllerRef.current?.abort()}
      />
    </div>
  );
}
