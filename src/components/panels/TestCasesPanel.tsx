import { useCallback, useEffect, useRef, useState } from "react";
import { useRememberedState } from "../../lib/remember";
import { Plus } from "lucide-react";
import type { TestCase, Testpaq } from "../../shared/domain";
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

export function TestCasesPanel({
  item,
  update,
  selectedScenarioId,
  focusedCaseId,
  onSelect,
  onDraft,
  onReviewCoverage,
  onRevisionApplied,
  onFocusHandled,
  readOnly = false,
}: {
  item: Testpaq;
  update: (recipe: (item: Testpaq) => Testpaq) => void;
  selectedScenarioId?: string;
  focusedCaseId?: string;
  onSelect: (id: string) => void;
  onDraft: (id: string, targetCaseId?: string) => void;
  onReviewCoverage?: (id: string) => void;
  onRevisionApplied?: () => void;
  onFocusHandled?: () => void;
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
    if (!focusedCaseId) return;
    focusCase(focusedCaseId);
    onFocusHandled?.();
  }, [focusedCaseId, focusCase, onFocusHandled]);
  useEffect(() => {
    focusCase(createdId);
  }, [createdId, focusCase]);
  const parent =
    item.scenarios.find((value) => value.id === selectedScenarioId) ??
    item.scenarios.find((value) => value.review === "accepted" && !value.archived) ??
    item.scenarios[0];
  const cases = (item.testCases ?? []).filter((value) => value.scenarioId === parent?.id);
  const visibleCases = cases.filter(
    (value) =>
      (showArchivedCases || !value.archived) &&
      value.title.toLowerCase().includes(caseQuery.toLowerCase()) &&
      (caseFilter === "all" || (caseFilter === "scope" ? caseNeedsReview(item, value) : value.review === caseFilter)),
  );
  const activeCase = visibleCases.find((value) => value.id === activeCaseId) ?? visibleCases[0];
  useEffect(() => {
    if (!activeCaseId) return;
    const card = panelRef.current?.querySelector<HTMLDetailsElement>(`[data-case-id="${activeCaseId}"]`);
    if (!card) return;
    card.open = true;
    card.scrollIntoView?.({ block: "start" });
    (card.querySelector<HTMLElement>(".revision-comparison") ?? card.querySelector<HTMLInputElement>("input:not([type=checkbox])"))?.focus({
      preventScroll: true,
    });
  }, [activeCaseId, activeCase?.id]);
  const canReview = Boolean(parent && parent.review === "accepted" && !parent.archived && !parent.scopeReviewRequired && !readOnly);
  const canCreate = canReview && (item.testCases?.length ?? 0) < 3000;
  const add = (legacy = false) => {
    if (!parent || !canCreate) return;
    update((draft) => {
      draft.testCases ??= [];
      const created = newTestCase(draft, parent, legacy);
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
  return (
    <div className="panel-stack test-cases-panel" ref={panelRef}>
      <div className="content-heading">
        <div>
          <p className="eyebrow">Detailed handoff</p>
          <h2>Linked test cases</h2>
          <p>Review the coverage intent first, then review its individual test cases. Each case can contain several steps.</p>
        </div>
      </div>
      <label className="field">
        <span>Coverage output</span>
        <select
          value={parent?.id ?? ""}
          onChange={(event) => {
            setCaseQuery("");
            setCaseFilter("all");
            onSelect(event.target.value);
          }}
        >
          {!item.scenarios.length && <option value="">No coverage outputs yet</option>}
          {item.scenarios.map((value) => (
            <option key={value.id} value={value.id}>
              {value.title} ({value.review}
              {value.archived ? ", archived" : ""})
            </option>
          ))}
        </select>
      </label>
      {parent && (
        <>
          <p>{parent.expectedOutcome}</p>
          <p className="muted">
            {cases.length} linked cases · {cases.filter((value) => value.review === "accepted" && !value.archived).length} accepted ·{" "}
            {cases.filter((value) => caseNeedsReview(item, value) && !value.archived).length} need scope review
          </p>
          {(parent.review !== "accepted" || parent.archived || parent.scopeReviewRequired) && (
            <p className="warning-note">
              Accept this coverage output and review its current scope before creating, accepting or exporting linked cases.
              {onReviewCoverage && (
                <Button size="sm" variant="secondary" onClick={() => onReviewCoverage(parent.id)}>
                  Review parent coverage
                </Button>
              )}
            </p>
          )}
          <div className="button-group">
            <Button disabled={!canCreate} icon={<Plus size={15} />} onClick={() => add()}>
              Add test case
            </Button>
            <Button variant="secondary" disabled={!canCreate} onClick={() => onDraft(parent.id)}>
              Draft test cases with AI
            </Button>
            {!cases.some((value) => value.origin === "legacy") && (
              <Button variant="ghost" disabled={!canCreate} onClick={() => add(true)}>
                Convert coverage to draft case
              </Button>
            )}
          </div>
          <p className="muted">
            AI drafting is a separate request you confirm before sending content. Converted coverage stays a proposal until you add details
            and accept it.
          </p>
        </>
      )}
      {!cases.length && <p className="inline-empty">No linked cases. Add one manually or draft cases for accepted coverage.</p>}
      {!!cases.length && (
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
            <label>
              <input type="checkbox" checked={showArchivedCases} onChange={(event) => setShowArchivedCases(event.target.checked)} /> Show
              archived cases
            </label>
          </div>
          <nav className="case-list" aria-label="Linked case list">
            {visibleCases.map((value) => (
              <button
                className="case-list-item"
                key={value.id}
                aria-label={`${value.title} — ${value.replacesCaseId ? "Proposed update" : value.review}`}
                aria-current={activeCase?.id === value.id ? "true" : undefined}
                onClick={() => setActiveCaseId(value.id)}
              >
                <strong>{value.title}</strong>
                <span>
                  {value.replacesCaseId ? "Proposed update" : value.review}
                  {caseNeedsReview(item, value) ? " · scope changed" : ""}
                  {value.archived ? " · archived" : ""}
                </span>
              </button>
            ))}
          </nav>
          {!visibleCases.length && <p className="inline-empty">No cases match these filters.</p>}
          {activeCase && (
            <div className="button-group">
              <span>
                Case {visibleCases.indexOf(activeCase) + 1} of {visibleCases.length}
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
      )}
      {(activeCase ? [activeCase] : []).map((value) => {
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
        return (
          <details className="test-case-card" key={value.id} data-case-id={value.id} open>
            <summary>
              <strong>{value.title}</strong>
              <span className={`status status-${value.review}`}>{value.review}</span>
              {value.archived && <span>Archived</span>}
              {needsReview && <span className="risk">Review revised scope</span>}
            </summary>
            <div className="test-case-content">
              <p className="muted">
                {value.origin === "generated" ? "AI-generated case" : value.origin === "legacy" ? "Converted coverage" : "Human case"}
                {value.editedByHumanAt ? " · edited by a person" : ""} · {value.steps.length} steps
              </p>
              <fieldset disabled={readOnly || value.archived} className="case-destinations">
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
                  Manual coverage
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
              {value.replacesCaseId &&
                (() => {
                  const original = item.testCases?.find((entry) => entry.id === value.replacesCaseId);
                  return (
                    <section className="revision-comparison" aria-label="Proposed case update" tabIndex={-1}>
                      {original && value.replacesContentSignature !== testCaseContentSignature(original) && (
                        <p className="warning-note">The original case changed after this proposal. Request a new update before applying.</p>
                      )}
                      <h3>Proposed update — {original?.title ?? "original case unavailable"}</h3>
                      <p>
                        Compare the complete details. Applying keeps the original case ID and destinations and requires acceptance again.
                      </p>
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
                                  <dt>Cleanup</dt>
                                  <dd>{entry.postconditions || "None specified"}</dd>
                                </dl>
                                <ol>
                                  {entry.steps.map((step) => (
                                    <li key={step.id}>
                                      <strong>{step.action}</strong>
                                      <p>Data: {step.data || "None specified"}</p>
                                      <p>Expected: {step.expectedResult}</p>
                                    </li>
                                  ))}
                                </ol>
                                {!!entry.unknowns.length && (
                                  <>
                                    <h4>Missing details</h4>
                                    <ul>
                                      {entry.unknowns.map((unknown) => (
                                        <li key={unknown}>{unknown}</li>
                                      ))}
                                    </ul>
                                  </>
                                )}
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
                          setCreatedId(value.replacesCaseId);
                          onRevisionApplied?.();
                        }}
                      >
                        Apply proposed update
                      </Button>
                    </section>
                  );
                })()}
              <div className="button-group">
                {!value.replacesCaseId && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canReview || value.archived}
                    onClick={() => onDraft(parent!.id, value.id)}
                  >
                    Suggest case update with AI
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={!canAccept}
                  onClick={() =>
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
                    )
                  }
                >
                  {needsReview ? "Accept current scope" : "Accept case"}
                </Button>
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
              {needsReview && (
                <p className="warning-note">
                  Changed: {caseScopeChanges(item, value).join(" · ")}. Review the case or request an AI update.
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
              {!canAccept && !value.replacesCaseId && !readOnly && (
                <p className="warning-note">
                  Before acceptance, confirm current parent coverage, resolve missing details and fill the title, objective, actions and
                  expected results.
                </p>
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
                <label className="field">
                  <span>Test objective</span>
                  <textarea
                    maxLength={5000}
                    value={value.objective}
                    aria-invalid={!value.objective.trim()}
                    onChange={(event) =>
                      edit(value.id, (testCase) => {
                        testCase.objective = event.target.value;
                      })
                    }
                  />
                </label>
                <div className="detail-grid">
                  <label className="field">
                    <span>Preconditions</span>
                    <textarea
                      maxLength={5000}
                      value={value.preconditions}
                      onChange={(event) =>
                        edit(value.id, (testCase) => {
                          testCase.preconditions = event.target.value;
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Postconditions / cleanup</span>
                    <textarea
                      maxLength={5000}
                      value={value.postconditions}
                      onChange={(event) =>
                        edit(value.id, (testCase) => {
                          testCase.postconditions = event.target.value;
                        })
                      }
                    />
                  </label>
                </div>
                {value.steps.map((step, index) => (
                  <div className="test-step" key={step.id}>
                    <div className="content-heading">
                      <strong>Step {index + 1}</strong>
                      <div className="button-group">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={index === 0}
                          onClick={() =>
                            edit(value.id, (testCase) => {
                              [testCase.steps[index - 1], testCase.steps[index]] = [testCase.steps[index], testCase.steps[index - 1]];
                            })
                          }
                        >
                          Move step up
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={value.steps.length === 1}
                          onClick={() =>
                            edit(value.id, (testCase) => {
                              testCase.steps.splice(index, 1);
                            })
                          }
                        >
                          Remove step
                        </Button>
                      </div>
                    </div>
                    <label className="field">
                      <span>Action</span>
                      <textarea
                        aria-label="Action"
                        maxLength={5000}
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
                        value={step.expectedResult}
                        aria-invalid={!step.expectedResult.trim()}
                        onChange={(event) =>
                          edit(value.id, (testCase) => {
                            testCase.steps[index].expectedResult = event.target.value;
                          })
                        }
                      />
                    </label>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="secondary"
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
                <p className="muted">Content edits return the case to Proposed. Destination changes do not change its review decision.</p>
              </fieldset>
            </div>
          </details>
        );
      })}
    </div>
  );
}
