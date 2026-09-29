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
import { useEffect, useMemo, useState } from "react";
import { label } from "../../lib/utils";
import type { Scenario, Testpaq } from "../../shared/domain";
import { Button } from "../ui/Button";

type Filter = "all" | Scenario["origin"] | Scenario["review"];

export function ReviewPanel({ item, update }: { item: Testpaq; update: (recipe: (item: Testpaq) => Testpaq) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string>();
  const [expanded, setExpanded] = useState<string>();
  const [undo, setUndo] = useState<Testpaq>();
  const visible = useMemo(
    () =>
      item.scenarios.filter(
        (scenario) =>
          (filter === "all" || scenario.origin === filter || scenario.review === filter) &&
          `${scenario.title} ${scenario.expectedOutcome}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [item.scenarios, filter, query],
  );

  const mutate = (ids: string[], recipe: (scenario: Scenario) => void) => {
    setUndo(structuredClone(item));
    update((draft) => {
      for (const scenario of draft.scenarios)
        if (ids.includes(scenario.id)) {
          recipe(scenario);
          scenario.updatedAt = new Date().toISOString();
        }
      return draft;
    });
  };
  const activeIds = selected.size ? [...selected] : focusedId ? [focusedId] : [];
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
      const currentIndex = visible.findIndex((scenario) => scenario.id === focusedId);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const next = visible[Math.max(0, Math.min(visible.length - 1, currentIndex + delta))];
        if (next) setFocusedId(next.id);
        return;
      }
      if (!activeIds.length) return;
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
  const filterValues: Filter[] = ["all", "proposed", "accepted", "rejected", "explicit", "inferred", "human"];
  return (
    <div className="review-layout">
      <aside className="review-sidebar">
        <p className="eyebrow">View</p>
        {filterValues.map((value) => (
          <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
            <span>{label(value)}</span>
            <em>
              {value === "all"
                ? item.scenarios.length
                : item.scenarios.filter((scenario) => scenario.origin === value || scenario.review === value).length}
            </em>
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
          <Button icon={<Plus size={16} />} onClick={addScenario}>
            Add scenario
          </Button>
        </div>
        <div className="review-toolbar">
          <label className="search">
            <Search size={15} />
            <span className="sr-only">Search scenarios</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter scenarios…" />
          </label>
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
        {selected.size > 0 && (
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
              Qase candidate
            </button>
            <button
              onClick={() =>
                mutate([...selected], (scenario) => {
                  scenario.destinations.automation = true;
                })
              }
            >
              Automation candidate
            </button>
            <button className="bulk-clear" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        )}
        {undo && (
          <button
            className="undo-toast"
            onClick={() => {
              const snapshot = undo;
              setUndo(undefined);
              update(() => snapshot);
            }}
          >
            Action applied · Undo
          </button>
        )}
        <div className="scenario-list" role="listbox" aria-label="Scenarios" aria-multiselectable="true">
          {visible.map((scenario) => (
            <ScenarioRow
              key={scenario.id}
              scenario={scenario}
              item={item}
              focused={focusedId === scenario.id}
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
  scenario,
  item,
  focused,
  selected,
  expanded,
  onFocus,
  onSelect,
  onExpand,
  update,
  mutate,
}: {
  scenario: Scenario;
  item: Testpaq;
  focused: boolean;
  selected: boolean;
  expanded: boolean;
  onFocus: () => void;
  onSelect: (value: boolean) => void;
  onExpand: () => void;
  update: (recipe: (item: Testpaq) => Testpaq) => void;
  mutate: (recipe: (scenario: Scenario) => void) => void;
}) {
  const Icon = scenario.origin === "human" ? UserRound : scenario.origin === "inferred" ? Bot : Save;
  const linked = scenario.requirementIds
    .map((id) => item.requirements.findIndex((requirement) => requirement.id === id) + 1)
    .filter(Boolean);
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
      role="option"
      aria-selected={selected}
      tabIndex={focused ? 0 : -1}
      onClick={onFocus}
    >
      <div className="scenario-summary">
        <button
          className="select-button"
          aria-label={selected ? "Deselect scenario" : "Select scenario"}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(!selected);
          }}
        >
          {selected ? <Square className="selected-square" size={16} /> : <Square size={16} />}
        </button>
        <button className="expand-button" aria-label={expanded ? "Collapse scenario" : "Expand scenario"} onClick={onExpand}>
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
            {linked.length ? <span>R{linked.join(", R")}</span> : <span>Additional coverage</span>}
            {scenario.risks.length > 0 && (
              <span className="risk">
                <AlertTriangle size={12} /> Risk
              </span>
            )}
          </span>
        </div>
        <div className="destinations">
          <button
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
            aria-pressed={scenario.destinations.qase}
            title="Intended for Qase; not yet created"
            onClick={() =>
              mutate((value) => {
                value.destinations.qase = !value.destinations.qase;
              })
            }
          >
            <Circle size={13} />
            Qase
          </button>
          <button
            aria-pressed={scenario.destinations.automation}
            title="Automation candidate; not yet automated"
            onClick={() =>
              mutate((value) => {
                value.destinations.automation = !value.destinations.automation;
              })
            }
          >
            <Code2 size={13} />
            Automation
          </button>
        </div>
        <div className="review-actions">
          <button
            className="accept"
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
          <label className="field">
            <span>Scenario title</span>
            <input
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
              value={scenario.expectedOutcome}
              onChange={(event) =>
                patch((value) => {
                  value.expectedOutcome = event.target.value;
                })
              }
            />
          </label>
          <div className="detail-grid">
            <label className="field">
              <span>Category</span>
              <select
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
                        scenario.origin === "explicit" &&
                        scenario.requirementIds.length === 1 &&
                        scenario.requirementIds.includes(requirement.id)
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
    item.scenarios.filter((scenario) => scenario.review === "accepted").flatMap((scenario) => scenario.requirementIds),
  );
  return item.requirements.filter((requirement) => requirement.active && !covered.has(requirement.id)).length;
}
