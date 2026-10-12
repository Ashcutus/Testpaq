import { Plus } from "lucide-react";
import type { TestCase, Testpaq } from "../../shared/domain";
import { caseNeedsReview, caseScopeSignature, newTestCase } from "../../shared/test-cases";
import { Button } from "../ui/Button";

export function TestCasesPanel({
  item,
  update,
  selectedScenarioId,
  onSelect,
  onDraft,
  readOnly = false,
}: {
  item: Testpaq;
  update: (recipe: (item: Testpaq) => Testpaq) => void;
  selectedScenarioId?: string;
  onSelect: (id: string) => void;
  onDraft: (id: string) => void;
  readOnly?: boolean;
}) {
  const parent =
    item.scenarios.find((value) => value.id === selectedScenarioId) ??
    item.scenarios.find((value) => value.review === "accepted" && !value.archived) ??
    item.scenarios[0];
  const cases = (item.testCases ?? []).filter((value) => value.scenarioId === parent?.id);
  const canReview = Boolean(parent && parent.review === "accepted" && !parent.archived && !parent.scopeReviewRequired && !readOnly);
  const canCreate = canReview && (item.testCases?.length ?? 0) < 3000;
  const add = (legacy = false) => {
    if (!parent || !canCreate) return;
    update((draft) => {
      draft.testCases ??= [];
      draft.testCases.push(newTestCase(draft, parent, legacy));
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
    <div className="panel-stack test-cases-panel">
      <div className="content-heading">
        <div>
          <p className="eyebrow">Detailed handoff</p>
          <h2>Linked test cases</h2>
          <p>Review the coverage intent first, then review its individual test cases. Each case can contain several steps.</p>
        </div>
      </div>
      <label className="field">
        <span>Coverage output</span>
        <select value={parent?.id ?? ""} onChange={(event) => onSelect(event.target.value)}>
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
            and accept it. Cypress code generation is outside v0.3.
          </p>
        </>
      )}
      {!cases.length && <p className="inline-empty">No linked cases. Add one manually or draft cases for accepted coverage.</p>}
      {cases.map((value) => {
        const needsReview = caseNeedsReview(item, value);
        const canAccept =
          canReview &&
          !value.archived &&
          !value.unknowns.length &&
          value.title.trim() &&
          value.objective.trim() &&
          value.steps.every((step) => step.action.trim() && step.expectedResult.trim());
        return (
          <details className="test-case-card" key={value.id} open>
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
              <div className="button-group">
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
                <div className="case-destinations">
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
                      checked={value.destinations.qase}
                      onChange={(event) =>
                        edit(
                          value.id,
                          (testCase) => {
                            testCase.destinations.qase = event.target.checked;
                          },
                          false,
                        )
                      }
                    />{" "}
                    Qase CSV
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={value.destinations.automation}
                      onChange={(event) =>
                        edit(
                          value.id,
                          (testCase) => {
                            testCase.destinations.automation = event.target.checked;
                          },
                          false,
                        )
                      }
                    />{" "}
                    To be automated in Qase
                  </label>
                </div>
                <p className="muted">Content edits return the case to Proposed. Destination changes do not change its review decision.</p>
              </fieldset>
            </div>
          </details>
        );
      })}
    </div>
  );
}
