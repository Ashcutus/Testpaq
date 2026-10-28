import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useRememberedState } from "../../lib/remember";
import { MAX_TEST_CASES, type TestCase, type Testpaq } from "../../shared/domain";
import {
  caseAuthoringIssues,
  caseScopeChanges,
  applyCaseRevision,
  caseNeedsReview,
  caseScopeSignature,
  newTestCase,
  testCaseContentSignature,
} from "../../shared/test-cases";
import { Button } from "../ui/Button";

const usable = (value: Testpaq["scenarios"][number]) => value.review === "accepted" && !value.archived && !value.scopeReviewRequired;

export function TestCasesPanel({
  item,
  update,
  selectedScenarioId,
  onSelect,
  onReviewCoverage,
  onRevisionApplied,
  readOnly = false,
}: {
  item: Testpaq;
  update: (recipe: (item: Testpaq) => Testpaq) => void;
  selectedScenarioId?: string;
  onSelect: (id: string) => void;
  onReviewCoverage?: (id: string) => void;
  onRevisionApplied?: () => void;
  readOnly?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [createdId, setCreatedId] = useState<string>();
  const [activeCaseId, setActiveCaseId] = useRememberedState<string | undefined>(
    `${item.id}:active-case`,
    undefined,
    (value) => typeof value === "string",
  );
  const [caseQuery, setCaseQuery] = useRememberedState(`${item.id}:case-query`, "", (value) => typeof value === "string");
  const [caseFilter, setCaseFilter] = useRememberedState(`${item.id}:case-filter`, "all", (value) =>
    ["all", "proposed", "accepted", "scope", "rejected"].includes(String(value)),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showArchivedCases, setShowArchivedCases] = useState(false);
  const focusCase = useCallback(
    (id?: string) => {
      if (!id) return;
      setActiveCaseId(id);
      setCaseQuery("");
      setCaseFilter("all");
    },
    [setActiveCaseId, setCaseFilter, setCaseQuery],
  );
  useEffect(() => {
    focusCase(createdId);
  }, [createdId, focusCase]);

  const coverageFilter = item.scenarios.find((value) => value.id === selectedScenarioId);
  const allCases = (item.testCases ?? []).filter((value) => !coverageFilter || value.scenarioId === coverageFilter.id);
  const visibleCases = allCases.filter(
    (value) =>
      (showArchivedCases || !value.archived) &&
      value.title.toLowerCase().includes(caseQuery.toLowerCase()) &&
      (caseFilter === "all" || (caseFilter === "scope" ? caseNeedsReview(item, value) : value.review === caseFilter)),
  );
  const activeCase = visibleCases.find((value) => value.id === activeCaseId) ?? visibleCases[0];
  const parentOf = (value?: TestCase) => item.scenarios.find((scenario) => scenario.id === value?.scenarioId);
  const activeParent = parentOf(activeCase);
  useEffect(() => {
    if (!activeCaseId) return;
    const card = panelRef.current?.querySelector<HTMLElement>(`[data-case-id="${activeCaseId}"]`);
    if (!card) return;
    card.scrollIntoView?.({ block: "nearest" });
    (card.querySelector<HTMLElement>(".revision-comparison") ?? card.querySelector<HTMLInputElement>("input:not([type=checkbox])"))?.focus({
      preventScroll: true,
    });
  }, [activeCaseId, activeCase?.id]);

  // New cases go under the filtered coverage, else beside the open case, else the first approved coverage.
  // A filter on coverage that cannot take cases never falls back elsewhere: the new case would be hidden by that filter.
  const addParent = coverageFilter
    ? usable(coverageFilter)
      ? coverageFilter
      : undefined
    : [activeParent, ...item.scenarios].find((value) => value && usable(value));
  const canCreate = Boolean(addParent && !readOnly && (item.testCases?.length ?? 0) < MAX_TEST_CASES);
  const add = () => {
    if (!addParent || !canCreate) return;
    update((draft) => {
      draft.testCases ??= [];
      const created = newTestCase(draft, addParent);
      draft.testCases.push(created);
      setCreatedId(created.id);
      return draft;
    });
  };
  const edit = (id: string, recipe: (value: TestCase, draft: Testpaq) => void, contentChange = true) => {
    if (readOnly) return;
    update((draft) => {
      const value = draft.testCases?.find((value) => value.id === id);
      if (!value) return draft;
      recipe(value, draft);
      value.updatedAt = new Date().toISOString();
      if (contentChange) {
        value.editedByHumanAt = value.updatedAt;
        value.review = "proposed";
      }
      return draft;
    });
  };
  const canReviewCase = (value: TestCase) => {
    const parent = parentOf(value);
    return Boolean(parent && usable(parent) && !readOnly);
  };
  const selectedCases = visibleCases.filter((value) => selected.has(value.id));
  const readyToAccept = (value: TestCase) =>
    canReviewCase(value) && !value.archived && !value.replacesCaseId && !value.unknowns.length && !caseAuthoringIssues(value).length;
  const bulkBlocked = selectedCases.some((value) => !readyToAccept(value) || caseNeedsReview(item, value));
  const bulkReview = (review: "accepted" | "rejected") => {
    if (readOnly || !selectedCases.length || (review === "accepted" && bulkBlocked)) return;
    const ids = new Set(selectedCases.map((value) => value.id));
    update((draft) => {
      for (const value of draft.testCases ?? [])
        if (ids.has(value.id) && !value.archived) {
          value.review = review;
          value.updatedAt = new Date().toISOString();
          if (review === "accepted")
            value.sourceSignature = caseScopeSignature(
              draft,
              draft.scenarios.find((scenario) => scenario.id === value.scenarioId)!,
            );
        }
      return draft;
    });
    setSelected(new Set());
  };
  const groups = item.scenarios
    .map((scenario) => ({ scenario, cases: visibleCases.filter((value) => value.scenarioId === scenario.id) }))
    .filter((group) => group.cases.length);

  return (
    <div className="panel-stack test-cases-panel" ref={panelRef}>
      <div className="content-heading">
        <div>
          <p className="eyebrow">Step 4 · Write and review</p>
          <h2>Test cases</h2>
          <p>Add cases yourself or use Analyse to draft them for approved coverage. Select a case to edit it.</p>
        </div>
        <Button disabled={!canCreate} icon={<Plus size={15} />} onClick={add}>
          Add test case
        </Button>
      </div>
      <div className="cases-toolbar">
        <label className="field">
          <span>Coverage output</span>
          <select value={coverageFilter?.id ?? ""} onChange={(event) => onSelect(event.target.value)}>
            <option value="">All coverage</option>
            {item.scenarios.map((value) => (
              <option key={value.id} value={value.id}>
                {value.title} ({value.review}
                {value.archived ? ", archived" : ""})
              </option>
            ))}
          </select>
        </label>
        {canCreate && addParent && <p className="muted">New cases are added under “{addParent.title}”.</p>}
        {!addParent && !readOnly && (
          <p className="warning-note">
            {coverageFilter
              ? "This coverage is not approved and current, so cases cannot be added to it. Review it, or choose All coverage."
              : "Approve coverage in Coverage approval before adding or accepting cases."}
            {onReviewCoverage && item.scenarios[0] && (
              <Button size="sm" variant="secondary" onClick={() => onReviewCoverage(coverageFilter?.id ?? item.scenarios[0].id)}>
                Review coverage
              </Button>
            )}
          </p>
        )}
      </div>
      {!allCases.length && <p className="inline-empty">No test cases yet. Add one, or use Analyse to draft cases for approved coverage.</p>}
      {!!allCases.length && (
        <div className="cases-layout">
          <section className="case-browser" aria-label="Choose a test case">
            <div className="case-browser-filters">
              <label className="field">
                <span>Search linked cases</span>
                <input value={caseQuery} onChange={(event) => setCaseQuery(event.target.value)} />
              </label>
              <label className="field">
                <span>Case review filter</span>
                <select value={caseFilter} onChange={(event) => setCaseFilter(event.target.value)}>
                  <option value="all">All cases</option>
                  <option value="proposed">Proposed</option>
                  <option value="accepted">Accepted</option>
                  <option value="scope">Scope changed</option>
                  <option value="rejected">Rejected</option>
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={showArchivedCases} onChange={(event) => setShowArchivedCases(event.target.checked)} /> Show
                archived
              </label>
            </div>
            <div className="selection-toolbar" role="group" aria-label="Test case selection">
              <label>
                <input
                  type="checkbox"
                  aria-label="Select all test cases"
                  checked={!!visibleCases.length && visibleCases.every((value) => selected.has(value.id))}
                  ref={(node) => {
                    if (node) node.indeterminate = selectedCases.length > 0 && selectedCases.length < visibleCases.length;
                  }}
                  onChange={(event) => setSelected(event.target.checked ? new Set(visibleCases.map((value) => value.id)) : new Set())}
                />{" "}
                Select all
              </label>
              <span>{selectedCases.length} selected</span>
              {!readOnly && (
                <>
                  <Button size="sm" disabled={!selectedCases.length || bulkBlocked} onClick={() => bulkReview("accepted")}>
                    Approve selected cases
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!selectedCases.length || selectedCases.some((value) => value.archived)}
                    onClick={() => bulkReview("rejected")}
                  >
                    Decline selected cases
                  </Button>
                </>
              )}
            </div>
            {!!selectedCases.length && bulkBlocked && (
              <p className="muted">Incomplete cases, updates and changed scope need individual review before approval.</p>
            )}
            <nav className="case-list" aria-label="Linked case list">
              {groups.map(({ scenario, cases }) => (
                <div className="case-group" key={scenario.id}>
                  {(!coverageFilter || groups.length > 1) && <h3>{scenario.title}</h3>}
                  {cases.map((value) => (
                    <div className="case-list-row" key={value.id}>
                      <input
                        type="checkbox"
                        aria-label={`Select case: ${value.title}`}
                        checked={selected.has(value.id)}
                        onChange={(event) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(value.id);
                            else next.delete(value.id);
                            return next;
                          })
                        }
                      />
                      <button
                        className="case-list-item"
                        aria-label={`${value.title} — ${value.replacesCaseId ? "Proposed update" : value.review}`}
                        aria-current={activeCase?.id === value.id ? "true" : undefined}
                        onClick={() => setActiveCaseId(value.id)}
                      >
                        <strong>{value.title}</strong>
                        <span>
                          {value.replacesCaseId ? "Proposed update" : value.review}
                          {caseNeedsReview(item, value) ? " · scope changed" : ""}
                          {value.archived ? " · archived" : ""} · {value.steps.length} step{value.steps.length === 1 ? "" : "s"}
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </nav>
            {!visibleCases.length && <p className="inline-empty">No cases match these filters.</p>}
            {activeCase && visibleCases.length > 1 && (
              <div className="case-stepper">
                <span>
                  {visibleCases.indexOf(activeCase) + 1} of {visibleCases.length}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={visibleCases.indexOf(activeCase) === 0}
                  onClick={() => setActiveCaseId(visibleCases[visibleCases.indexOf(activeCase) - 1].id)}
                >
                  Previous case
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={visibleCases.indexOf(activeCase) === visibleCases.length - 1}
                  onClick={() => setActiveCaseId(visibleCases[visibleCases.indexOf(activeCase) + 1].id)}
                >
                  Next case
                </Button>
              </div>
            )}
          </section>
          {activeCase && (
            <CaseEditor
              key={activeCase.id}
              item={item}
              value={activeCase}
              parentTitle={activeParent?.title ?? "Unknown coverage"}
              canReview={canReviewCase(activeCase)}
              readOnly={readOnly}
              nextProposed={visibleCases.find((entry) => entry.id !== activeCase.id && entry.review === "proposed" && !entry.archived)}
              edit={edit}
              update={update}
              onOpen={setActiveCaseId}
              onApplied={(id) => {
                setCreatedId(id);
                onRevisionApplied?.();
              }}
              onReviewCoverage={onReviewCoverage}
            />
          )}
        </div>
      )}
    </div>
  );
}

function CaseEditor({
  item,
  value,
  parentTitle,
  canReview,
  readOnly,
  nextProposed,
  edit,
  update,
  onOpen,
  onApplied,
  onReviewCoverage,
}: {
  item: Testpaq;
  value: TestCase;
  parentTitle: string;
  canReview: boolean;
  readOnly: boolean;
  nextProposed?: TestCase;
  edit: (id: string, recipe: (value: TestCase, draft: Testpaq) => void, contentChange?: boolean) => void;
  update: (recipe: (item: Testpaq) => Testpaq) => void;
  onOpen: (id: string) => void;
  onApplied: (id: string) => void;
  onReviewCoverage?: (id: string) => void;
}) {
  const needsReview = caseNeedsReview(item, value);
  const authoringIssues = caseAuthoringIssues(value);
  const canAccept =
    !authoringIssues.length &&
    !value.replacesCaseId &&
    canReview &&
    !value.archived &&
    !value.unknowns.length &&
    value.title.trim() &&
    value.objective.trim() &&
    value.steps.every((step) => step.action.trim() && step.expectedResult.trim());
  const accept = () =>
    edit(
      value.id,
      (testCase, draft) => {
        testCase.review = "accepted";
        testCase.sourceSignature = caseScopeSignature(
          draft,
          draft.scenarios.find((scenario) => scenario.id === testCase.scenarioId)!,
        );
      },
      false,
    );
  const original = value.replacesCaseId ? item.testCases?.find((entry) => entry.id === value.replacesCaseId) : undefined;
  return (
    <article className="case-editor" data-case-id={value.id}>
      <header className="case-editor-head">
        <div>
          <span className={`status status-${value.review}`}>{value.replacesCaseId ? "proposed update" : value.review}</span>
          {value.archived && <span className="status">archived</span>}
          {needsReview && <span className="risk">Review revised scope</span>}
        </div>
        <p className="muted">
          {parentTitle} · {value.origin === "generated" ? "AI draft" : value.origin === "legacy" ? "Converted" : "Written by hand"}
          {value.editedByHumanAt && value.origin === "generated" ? " · edited" : ""}
        </p>
      </header>
      {value.replacesCaseId && (
        <section className="revision-comparison" aria-label="Proposed case update" tabIndex={-1}>
          {original && value.replacesContentSignature !== testCaseContentSignature(original) && (
            <p className="warning-note">The original case changed after this proposal. Run Analyse again to request a new update.</p>
          )}
          <h3>Proposed update — {original?.title ?? "original case unavailable"}</h3>
          <p>Compare the details. Applying keeps the original case ID and destinations and requires acceptance again.</p>
          <div className="detail-grid">
            {[original, value].map((entry, index) => (
              <div key={index}>
                <h4>{index ? "Proposed" : "Current"}</h4>
                {entry ? (
                  <div className="case-comparison-details">
                    <strong>{entry.title}</strong>
                    <p>{entry.objective}</p>
                    <dl>
                      <dt>Preconditions</dt>
                      <dd>{entry.preconditions || "None specified"}</dd>
                    </dl>
                    <ol>
                      {entry.steps.map((step) => (
                        <li key={step.id}>
                          <strong>{step.action}</strong>
                          {step.data && <p>Data: {step.data}</p>}
                          <p>Expected: {step.expectedResult}</p>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : (
                  <p>Unavailable</p>
                )}
              </div>
            ))}
          </div>
          <Button
            disabled={
              !canReview ||
              needsReview ||
              value.archived ||
              value.review === "rejected" ||
              !original ||
              original.archived ||
              value.replacesContentSignature !== testCaseContentSignature(original)
            }
            onClick={() => {
              update((draft) => applyCaseRevision(draft, value.id));
              onApplied(value.replacesCaseId!);
            }}
          >
            Apply proposed update
          </Button>
        </section>
      )}
      {needsReview && (
        <p className="warning-note">
          Changed: {caseScopeChanges(item, value).join(" · ")}. Review the case, or use Analyse to propose an update.
          {!canReview && onReviewCoverage && (
            <Button size="sm" variant="secondary" onClick={() => onReviewCoverage(value.scenarioId)}>
              Review coverage
            </Button>
          )}
        </p>
      )}
      {!!value.unknowns.length && (
        <div className="warning-note">
          <p>Resolve missing details before accepting this case:</p>
          {value.unknowns.map((unknown, index) => (
            <div className="case-unknown" key={index}>
              <span>{unknown}</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={readOnly || value.archived}
                onClick={() =>
                  edit(value.id, (testCase) => {
                    testCase.unknowns.splice(index, 1);
                  })
                }
              >
                Mark detail resolved
              </Button>
            </div>
          ))}
        </div>
      )}
      <fieldset disabled={readOnly || value.archived} className="case-fields">
        <label className="field">
          <span>Test case title</span>
          <input
            maxLength={300}
            value={value.title}
            aria-invalid={!value.title.trim()}
            onChange={(event) =>
              edit(value.id, (testCase) => {
                testCase.title = event.target.value;
              })
            }
          />
        </label>
        <div className="detail-grid">
          <label className="field">
            <span>Description</span>
            <textarea
              aria-label="Case description"
              maxLength={5000}
              rows={3}
              value={value.objective}
              aria-invalid={!value.objective.trim()}
              onChange={(event) =>
                edit(value.id, (testCase) => {
                  testCase.objective = event.target.value;
                })
              }
            />
          </label>
          <label className="field">
            <span>Preconditions</span>
            <textarea
              maxLength={5000}
              rows={3}
              value={value.preconditions}
              onChange={(event) =>
                edit(value.id, (testCase) => {
                  testCase.preconditions = event.target.value;
                })
              }
            />
          </label>
        </div>
        <div className="steps-head">
          <h3>Steps</h3>
          <span>Action, optional test data and the observable result.</span>
        </div>
        <ol className="step-list">
          {value.steps.map((step, index) => (
            <li className="step-row" key={step.id}>
              <span className="step-number">{index + 1}</span>
              <label className="field">
                <span>Action</span>
                <textarea
                  aria-label="Action"
                  maxLength={5000}
                  rows={2}
                  value={step.action}
                  aria-invalid={!step.action.trim()}
                  onChange={(event) =>
                    edit(value.id, (testCase) => {
                      testCase.steps[index].action = event.target.value;
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Test data</span>
                <textarea
                  aria-label="Test data"
                  maxLength={3000}
                  rows={2}
                  value={step.data}
                  onChange={(event) =>
                    edit(value.id, (testCase) => {
                      testCase.steps[index].data = event.target.value;
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Expected result</span>
                <textarea
                  aria-label="Expected result"
                  maxLength={5000}
                  rows={2}
                  value={step.expectedResult}
                  aria-invalid={!step.expectedResult.trim()}
                  onChange={(event) =>
                    edit(value.id, (testCase) => {
                      testCase.steps[index].expectedResult = event.target.value;
                    })
                  }
                />
              </label>
              <div className="step-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Move step up"
                  title="Move step up"
                  disabled={index === 0}
                  onClick={() =>
                    edit(value.id, (testCase) => {
                      [testCase.steps[index - 1], testCase.steps[index]] = [testCase.steps[index], testCase.steps[index - 1]];
                    })
                  }
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Move step down"
                  title="Move step down"
                  disabled={index === value.steps.length - 1}
                  onClick={() =>
                    edit(value.id, (testCase) => {
                      [testCase.steps[index + 1], testCase.steps[index]] = [testCase.steps[index], testCase.steps[index + 1]];
                    })
                  }
                >
                  <ArrowDown size={15} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Remove step"
                  title="Remove step"
                  disabled={value.steps.length === 1}
                  onClick={() =>
                    edit(value.id, (testCase) => {
                      testCase.steps.splice(index, 1);
                    })
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          ))}
        </ol>
        <Button
          size="sm"
          variant="secondary"
          icon={<Plus size={14} />}
          disabled={value.steps.length >= 50}
          onClick={() =>
            edit(value.id, (testCase) => {
              testCase.steps.push({
                id: crypto.randomUUID(),
                action: "Describe the next action",
                data: "",
                expectedResult: "Describe the observable result",
              });
            })
          }
        >
          Add step
        </Button>
      </fieldset>
      <footer className="case-editor-foot">
        <fieldset disabled={readOnly || value.archived} className="case-destinations">
          <legend>Include in handoff</legend>
          <label>
            <input
              type="checkbox"
              checked={value.destinations.manual}
              onChange={(event) =>
                edit(
                  value.id,
                  (testCase) => {
                    testCase.destinations.manual = event.target.checked;
                  },
                  false,
                )
              }
            />{" "}
            Manual
          </label>
          <label>
            <input
              type="checkbox"
              checked={value.destinations.qase || value.destinations.automation}
              onChange={(event) =>
                edit(
                  value.id,
                  (testCase) => {
                    testCase.destinations.qase = event.target.checked;
                    if (!event.target.checked) testCase.destinations.automation = false;
                  },
                  false,
                )
              }
            />{" "}
            Qase CSV
          </label>
        </fieldset>
        {!canAccept && !value.replacesCaseId && !readOnly && (
          <p className="muted">
            To accept: approved current coverage, no missing details, and a title, description, action and expected result filled in.
          </p>
        )}
        <div className="button-group">
          <Button size="sm" disabled={!canAccept || (value.review === "accepted" && !needsReview)} onClick={accept}>
            {needsReview ? "Accept current scope" : value.review === "accepted" ? "Case accepted" : "Accept case"}
          </Button>
          {nextProposed && (
            <Button
              size="sm"
              disabled={!canAccept || (value.review === "accepted" && !needsReview)}
              onClick={() => {
                accept();
                onOpen(nextProposed.id);
              }}
            >
              Accept and review next
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={readOnly || value.archived}
            onClick={() =>
              edit(
                value.id,
                (testCase) => {
                  testCase.review = "rejected";
                },
                false,
              )
            }
          >
            Reject case
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={readOnly}
            onClick={() =>
              edit(
                value.id,
                (testCase) => {
                  testCase.archived = !testCase.archived;
                },
                false,
              )
            }
          >
            {value.archived ? "Restore case" : "Archive case"}
          </Button>
        </div>
      </footer>
    </article>
  );
}
