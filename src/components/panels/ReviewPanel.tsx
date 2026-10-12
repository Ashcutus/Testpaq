import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Code2,
  Edit3,
  Plus,
  Save,
  Search,
  Square,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { label } from "../../lib/utils";
import type { Scenario, Testpaq } from "../../shared/domain";
import { activeRequirementNumbers } from "../../shared/export";
import { Button } from "../ui/Button";

export function ReviewPanel({
  item,
  update,
  readOnly = false,
}: {
  item: Testpaq;
  update: (recipe: (item: Testpaq) => Testpaq) => void;
  readOnly?: boolean;
}) {
  const [originFilter, setOriginFilter] = useState<Scenario["origin"] | "all">("all");
  const [reviewFilter, setReviewFilter] = useState<Scenario["review"] | "all">("all");
  const [coverageFilter, setCoverageFilter] = useState<"all" | "unlinked">("all");
  const [categoryFilter, setCategoryFilter] = useState<Scenario["category"] | "all">("all");
  const [destinationFilter, setDestinationFilter] = useState<"all" | "manual" | "qase" | "automation">("all");
  const [riskOnly, setRiskOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string>();
  const [expanded, setExpanded] = useState<string>();
  const [undo, setUndo] = useState<{ before: Scenario[]; after: Map<string, string> }>();
  const canUndo =
    !readOnly &&
    undo &&
    undo.before.every((value) => JSON.stringify(item.scenarios.find((scenario) => scenario.id === value.id)) === undo.after.get(value.id));
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const requirementNumbers = activeRequirementNumbers(item);
  const visible = useMemo(
    () =>
      item.scenarios.filter(
        (scenario) =>
          (showArchived || !scenario.archived) &&
          (originFilter === "all" || scenario.origin === originFilter) &&
          (reviewFilter === "all" || scenario.review === reviewFilter) &&
          (coverageFilter === "all" || scenario.requirementIds.length === 0) &&
          (categoryFilter === "all" || scenario.category === categoryFilter) &&
          (destinationFilter === "all" || scenario.destinations[destinationFilter]) &&
          (!riskOnly || scenario.risks.length > 0) &&
          `${scenario.title} ${scenario.expectedOutcome}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [item.scenarios, showArchived, originFilter, reviewFilter, coverageFilter, categoryFilter, destinationFilter, riskOnly, query],
  );

  const mutate = (ids: string[], recipe: (scenario: Scenario) => void) => {
    if (readOnly) return;
    const before = structuredClone(item.scenarios.filter((scenario) => ids.includes(scenario.id)));
    update((draft) => {
      for (const scenario of draft.scenarios)
        if (ids.includes(scenario.id)) {
          recipe(scenario);
          scenario.updatedAt = new Date().toISOString();
        }
      setUndo({
        before,
        after: new Map(draft.scenarios.filter((value) => ids.includes(value.id)).map((value) => [value.id, JSON.stringify(value)])),
      });
      return draft;
    });
  };
  const activeFocusedId = visible.some((scenario) => scenario.id === focusedId) ? focusedId : visible[0]?.id;
  const activeIds = selected.size ? [...selected] : activeFocusedId ? [activeFocusedId] : [];
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>("[data-scenario-id]");
      if (!row || row !== target || target.isContentEditable) return;
      const currentIndex = visible.findIndex((scenario) => scenario.id === activeFocusedId);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const next = visible[Math.max(0, Math.min(visible.length - 1, currentIndex + delta))];
        if (next) {
          setFocusedId(next.id);
          rowRefs.current.get(next.id)?.focus();
        }
        return;
      }
      if (!activeIds.length || readOnly) return;
      const key = event.key.toLowerCase();
      if (key === "a")
        mutate(activeIds, (scenario) => {
          scenario.review = "accepted";
        });
      if (key === "r")
        mutate(activeIds, (scenario) => {
          scenario.review = "rejected";
        });
      if (key === "m")
        mutate(activeIds, (scenario) => {
          scenario.destinations.manual = !scenario.destinations.manual;
        });
      if (key === "q")
        mutate(activeIds, (scenario) => {
          scenario.destinations.qase = !scenario.destinations.qase;
        });
      if (key === "c")
        mutate(activeIds, (scenario) => {
          scenario.destinations.automation = !scenario.destinations.automation;
        });
      if (key === "e" && activeIds.length === 1) setExpanded(activeIds[0]);
    };
    addEventListener("keydown", handler);
    return () => removeEventListener("keydown", handler);
  });
  const addScenario = () =>
    update((draft) => {
      const timestamp = new Date().toISOString();
      const scenario: Scenario = {
        id: crypto.randomUUID(),
        title: "New QA scenario",
        expectedOutcome: "Describe the expected behaviour.",
        origin: "human",
        category: "other",
        review: "proposed",
        requirementIds: [],
        risks: [],
        destinations: { manual: true, qase: false, automation: false },
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      draft.scenarios.unshift(scenario);
      setFocusedId(scenario.id);
      setExpanded(scenario.id);
      return draft;
    });
  return (
    <div className="review-layout">
      <aside className="review-sidebar">
        <p className="eyebrow">View</p>
        <p className="eyebrow">Origin</p>
        {(["all", "explicit", "inferred", "human"] as const).map((value) => (
          <button key={value} aria-pressed={originFilter === value} onClick={() => setOriginFilter(value)}>
            <span>{value === "all" ? "All origins" : label(value)}</span>
            <em>{value === "all" ? item.scenarios.length : item.scenarios.filter((scenario) => scenario.origin === value).length}</em>
          </button>
        ))}
        <p className="eyebrow">Review status</p>
        {(["all", "proposed", "accepted", "rejected"] as const).map((value) => (
          <button key={value} aria-pressed={reviewFilter === value} onClick={() => setReviewFilter(value)}>
            <span>{value === "all" ? "All statuses" : label(value)}</span>
            <em>{value === "all" ? item.scenarios.length : item.scenarios.filter((scenario) => scenario.review === value).length}</em>
          </button>
        ))}
        <div className="coverage-gap">
          <strong>{uncoveredCount(item)}</strong>
          <span>requirements without accepted coverage</span>
        </div>
      </aside>
      <div className="review-main">
        <div className="content-heading review-heading">
          <div>
            <p className="eyebrow">Human review</p>
            <h2>Scenarios</h2>
            <p>{visible.length} shown · Suggestions remain proposals until you decide.</p>
          </div>
          <Button disabled={readOnly} icon={<Plus size={16} />} onClick={addScenario}>
            Add scenario
          </Button>
        </div>
        <div className="review-toolbar">
          <label className="search">
            <Search size={15} />
            <span className="sr-only">Search scenarios</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter scenarios…" />
          </label>
          <label className="review-filter">
            <span className="sr-only">Filter by category</span>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as typeof categoryFilter)}>
              <option value="all">All categories</option>
              {[...new Set(item.scenarios.map((scenario) => scenario.category))].sort().map((category) => (
                <option value={category} key={category}>
                  {label(category)}
                </option>
              ))}
            </select>
          </label>
          <label className="review-filter">
            <span className="sr-only">Filter by intended destination</span>
            <select value={destinationFilter} onChange={(event) => setDestinationFilter(event.target.value as typeof destinationFilter)}>
              <option value="all">All destinations</option>
              <option value="manual">Manual</option>
              <option value="qase">Qase CSV</option>
              <option value="automation">Cypress</option>
            </select>
          </label>
          <label className="review-filter">
            <span className="sr-only">Filter by requirement coverage</span>
            <select value={coverageFilter} onChange={(event) => setCoverageFilter(event.target.value as typeof coverageFilter)}>
              <option value="all">All coverage</option>
              <option value="unlinked">Unlinked only</option>
            </select>
          </label>
          <button className="risk-filter" aria-pressed={riskOnly} onClick={() => setRiskOnly((current) => !current)}>
            <AlertTriangle size={14} /> Risk only
          </button>
          <button
            className="risk-filter"
            onClick={() =>
              setSelected((current) => {
                const next = new Set(current);
                const allSelected = visible.length > 0 && visible.every((scenario) => next.has(scenario.id));
                for (const scenario of visible) {
                  if (allSelected) next.delete(scenario.id);
                  else next.add(scenario.id);
                }
                return next;
              })
            }
          >
            {visible.length > 0 && visible.every((scenario) => selected.has(scenario.id)) ? "Deselect shown" : "Select shown"}
          </button>
          <div className="shortcut-hints">
            <span>
              <kbd>A</kbd> accept
            </span>
            <span>
              <kbd>R</kbd> reject
            </span>
            <span>
              <kbd>E</kbd> edit
            </span>
            <span>
              <kbd>↑↓</kbd> move
            </span>
          </div>
        </div>
        {selected.size > 0 && !readOnly && (
          <div className="bulkbar">
            <strong>{selected.size} selected</strong>
            <button
              onClick={() =>
                mutate([...selected], (scenario) => {
                  scenario.review = "accepted";
                })
              }
            >
              <Check size={14} />
              Accept
            </button>
            <button
              onClick={() =>
                mutate([...selected], (scenario) => {
                  scenario.review = "rejected";
                })
              }
            >
              <X size={14} />
              Reject
            </button>
            <button
              onClick={() =>
                mutate([...selected], (scenario) => {
                  scenario.destinations.manual = true;
                })
              }
            >
              Manual
            </button>
            <button
              onClick={() =>
                mutate([...selected], (scenario) => {
                  scenario.destinations.qase = true;
                })
              }
            >
              Qase CSV
            </button>
            <button
              onClick={() =>
                mutate([...selected], (scenario) => {
                  scenario.destinations.automation = true;
                })
              }
            >
              Cypress
            </button>
            <button className="bulk-clear" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        )}
        {canUndo && undo && (
          <button
            className="undo-toast"
            onClick={() => {
              const snapshot = undo;
              setUndo(undefined);
              update((draft) => {
                for (const before of snapshot.before) {
                  const index = draft.scenarios.findIndex((value) => value.id === before.id);
                  draft.scenarios[index] = structuredClone(before);
                }
                return draft;
              });
            }}
          >
            Action applied · Undo
          </button>
        )}
        <label>
          <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Show archived
          scenarios
        </label>
        <div className="scenario-list" role="list" aria-label="Scenarios">
          {visible.map((scenario) => (
            <ScenarioRow
              key={scenario.id}
              readOnly={readOnly}
              scenario={scenario}
              item={item}
              requirementNumbers={requirementNumbers}
              focused={activeFocusedId === scenario.id}
              rowRef={(element) => {
                if (element) rowRefs.current.set(scenario.id, element);
                else rowRefs.current.delete(scenario.id);
              }}
              selected={selected.has(scenario.id)}
              expanded={expanded === scenario.id}
              onFocus={() => setFocusedId(scenario.id)}
              onSelect={(checked) =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (checked) next.add(scenario.id);
                  else next.delete(scenario.id);
                  return next;
                })
              }
              onExpand={() => setExpanded(expanded === scenario.id ? undefined : scenario.id)}
              update={update}
              mutate={(recipe) => mutate([scenario.id], recipe)}
            />
          ))}
          {!visible.length && <div className="inline-empty">No scenarios match this view.</div>}
        </div>
      </div>
    </div>
  );
}

function ScenarioRow({
  readOnly,
  scenario,
  item,
  requirementNumbers,
  focused,
  rowRef,
  selected,
  expanded,
  onFocus,
  onSelect,
  onExpand,
  update,
  mutate,
}: {
  readOnly: boolean;
  scenario: Scenario;
  item: Testpaq;
  requirementNumbers: Map<string, number>;
  focused: boolean;
  rowRef: (element: HTMLElement | null) => void;
  selected: boolean;
  expanded: boolean;
  onFocus: () => void;
  onSelect: (value: boolean) => void;
  onExpand: () => void;
  update: (recipe: (item: Testpaq) => Testpaq) => void;
  mutate: (recipe: (scenario: Scenario) => void) => void;
}) {
  const Icon = scenario.origin === "human" ? UserRound : scenario.origin === "inferred" ? Bot : Save;
  const linked = scenario.requirementIds.map((id) => requirementNumbers.get(id)).filter((value): value is number => value !== undefined);
  const hasInactiveLink = linked.length < scenario.requirementIds.length;
  const patch = (recipe: (value: Scenario) => void) =>
    update((draft) => {
      const value = draft.scenarios.find((entry) => entry.id === scenario.id)!;
      recipe(value);
      value.editedByHumanAt = new Date().toISOString();
      value.updatedAt = new Date().toISOString();
      return draft;
    });
  return (
    <article
      className={`scenario-row origin-border-${scenario.origin} ${focused ? "is-focused" : ""} review-${scenario.review}`}
      role="listitem"
      data-scenario-id={scenario.id}
      ref={rowRef}
      tabIndex={focused ? 0 : -1}
      onClick={onFocus}
      onFocus={onFocus}
    >
      <div className="scenario-summary">
        <button
          className="select-button"
          aria-label={selected ? "Deselect scenario" : "Select scenario"}
          aria-pressed={selected}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(!selected);
          }}
        >
          {selected ? <Square className="selected-square" size={16} /> : <Square size={16} />}
        </button>
        <button
          className="expand-button"
          aria-label={expanded ? "Collapse scenario" : "Expand scenario"}
          onClick={(event) => {
            event.stopPropagation();
            onExpand();
          }}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <span className={`origin-icon origin-${scenario.origin}`}>
          <Icon size={15} />
        </span>
        <div className="scenario-title">
          <strong>{scenario.title}</strong>
          <span>
            <em className={`origin origin-${scenario.origin}`}>{label(scenario.origin)}</em>
            <span>{label(scenario.category)}</span>
            {linked.length ? (
              <span>
                R{linked.join(", R")}
                {hasInactiveLink ? " · inactive link" : ""}
              </span>
            ) : hasInactiveLink ? (
              <span>Inactive requirement link</span>
            ) : (
              <span>Additional coverage</span>
            )}
            {scenario.archived && <span>Archived</span>}
            {scenario.scopeReviewRequired && <span className="risk">Review revised scope</span>}
            {scenario.risks.length > 0 && (
              <span className="risk">
                <AlertTriangle size={12} /> Risk
              </span>
            )}
          </span>
        </div>
        <div className="destinations">
          <button
            disabled={readOnly}
            aria-pressed={scenario.destinations.manual}
            onClick={() =>
              mutate((value) => {
                value.destinations.manual = !value.destinations.manual;
              })
            }
          >
            <UserRound size={13} />
            Manual
          </button>
          <button
            disabled={readOnly}
            aria-pressed={scenario.destinations.qase}
            aria-label="Include in Qase CSV"
            onClick={() =>
              mutate((value) => {
                value.destinations.qase = !value.destinations.qase;
              })
            }
          >
            <Circle size={13} />
            Qase CSV
          </button>
          <button
            disabled={readOnly}
            aria-pressed={scenario.destinations.automation}
            aria-label="Cypress; export to Qase as To be automated"
            onClick={() =>
              mutate((value) => {
                value.destinations.automation = !value.destinations.automation;
              })
            }
          >
            <Code2 size={13} />
            Cypress
          </button>
        </div>
        <div className="review-actions">
          <button
            className="accept"
            disabled={readOnly}
            aria-pressed={scenario.review === "accepted"}
            aria-label="Accept scenario"
            onClick={() =>
              mutate((value) => {
                value.review = "accepted";
              })
            }
          >
            <Check size={16} />
          </button>
          <button
            className="reject"
            disabled={readOnly}
            aria-pressed={scenario.review === "rejected"}
            aria-label="Reject scenario"
            onClick={() =>
              mutate((value) => {
                value.review = "rejected";
              })
            }
          >
            <X size={16} />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="scenario-details">
          {scenario.scopeReviewRequired && (
            <p className="warning-note">
              Accepted coverage may be affected by revised scope. Review its requirements and expected behaviour.
            </p>
          )}
          <div className="button-group">
            {scenario.scopeReviewRequired && (
              <Button
                disabled={readOnly}
                variant="secondary"
                size="sm"
                onClick={() =>
                  patch((value) => {
                    value.scopeReviewRequired = false;
                  })
                }
              >
                Reviewed current scope
              </Button>
            )}
            <Button
              disabled={readOnly}
              variant="ghost"
              size="sm"
              onClick={() =>
                mutate((value) => {
                  value.archived = !value.archived;
                })
              }
            >
              {scenario.archived ? "Restore scenario" : "Archive scenario"}
            </Button>
          </div>
          {(scenario.introducedInRun || scenario.lastChangedInRun) && (
            <p className="privacy-note">
              Introduced in analysis {scenario.introducedInRun?.slice(0, 8) ?? "before run tracking"}; last changed in{" "}
              {scenario.lastChangedInRun?.slice(0, 8) ?? "before run tracking"}.
            </p>
          )}
          <label className="field">
            <span>Scenario title</span>
            <input
              readOnly={readOnly}
              maxLength={300}
              aria-invalid={!scenario.title.trim()}
              value={scenario.title}
              onChange={(event) =>
                patch((value) => {
                  value.title = event.target.value;
                })
              }
            />
          </label>
          <label className="field">
            <span>Expected behaviour</span>
            <textarea
              rows={3}
              readOnly={readOnly}
              maxLength={5000}
              aria-invalid={!scenario.expectedOutcome.trim()}
              value={scenario.expectedOutcome}
              onChange={(event) =>
                patch((value) => {
                  value.expectedOutcome = event.target.value;
                })
              }
            />
          </label>
          {(!scenario.title.trim() || !scenario.expectedOutcome.trim()) && (
            <p className="attention">A scenario needs a title and expected behaviour before it can be saved.</p>
          )}
          <div className="detail-grid">
            <label className="field">
              <span>Category</span>
              <select
                disabled={readOnly}
                value={scenario.category}
                onChange={(event) =>
                  patch((value) => {
                    value.category = event.target.value as Scenario["category"];
                  })
                }
              >
                {[
                  "happy_path",
                  "negative",
                  "validation",
                  "boundary",
                  "regression",
                  "api",
                  "permissions",
                  "persistence",
                  "compatibility",
                  "other",
                ].map((category) => (
                  <option value={category} key={category}>
                    {label(category)}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="requirement-picker">
              <legend>Linked requirements</legend>
              {item.requirements
                .filter((value) => value.active)
                .map((requirement, index) => (
                  <label key={requirement.id}>
                    <input
                      type="checkbox"
                      checked={scenario.requirementIds.includes(requirement.id)}
                      disabled={
                        readOnly ||
                        (scenario.origin === "explicit" &&
                          scenario.requirementIds.length === 1 &&
                          scenario.requirementIds.includes(requirement.id))
                      }
                      onChange={(event) =>
                        patch((value) => {
                          value.requirementIds = event.target.checked
                            ? [...value.requirementIds, requirement.id]
                            : value.requirementIds.filter((id) => id !== requirement.id);
                        })
                      }
                    />
                    <span>R{index + 1}</span>
                    {requirement.text}
                  </label>
                ))}
            </fieldset>
          </div>
          {scenario.rationale && (
            <div className="rationale">
              <Edit3 size={14} />
              <span>
                <strong>Why Testpaq suggested this:</strong> {scenario.rationale}
              </span>
            </div>
          )}
          {scenario.risks.map((risk) => (
            <div className="risk-note" key={risk}>
              <AlertTriangle size={14} />
              {risk}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function uncoveredCount(item: Testpaq) {
  const covered = new Set(
    item.scenarios
      .filter((scenario) => scenario.review === "accepted" && !scenario.archived)
      .flatMap((scenario) => scenario.requirementIds),
  );
  return item.requirements.filter((requirement) => requirement.active && !covered.has(requirement.id)).length;
}
