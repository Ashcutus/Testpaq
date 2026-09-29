import { AlertCircle, ArrowRight, FileText, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppConfig } from "../App";
import { api } from "../lib/api";
import { formatRelative, label } from "../lib/utils";
import type { TestpaqSummary } from "../shared/domain";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";

export function TestpaqList({ config, onOpen }: { config?: AppConfig; onOpen: (id: string) => void }) {
  const [items, setItems] = useState<TestpaqSummary[]>([]);
  const [query, setQuery] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const load = () =>
    api
      .list()
      .then(setItems)
      .catch((reason: Error) => setError(reason.message));
  useEffect(() => {
    void load();
  }, []);
  const create = async () => {
    if (!title.trim()) return;
    try {
      const item = await api.create(title);
      setNewOpen(false);
      onOpen(item.id);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };
  const loadFixture = async (kind: "sample" | "stress") => {
    try {
      const item = await api.fixture(kind);
      onOpen(item.id);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };
  const filtered = items.filter((item) => `${item.title} ${item.reference}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="page page-list">
      <section className="page-heading">
        <div>
          <p className="eyebrow">QA change review</p>
          <h1>Testpaqs</h1>
          <p>Turn product intent into reviewed, traceable coverage.</p>
        </div>
        <Button icon={<Plus size={16} />} onClick={() => setNewOpen(true)}>
          New Testpaq
        </Button>
      </section>
      {error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={16} />
          {error}
        </div>
      )}
      <div className="list-toolbar">
        <label className="search">
          <Search size={16} />
          <span className="sr-only">Search Testpaqs</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Testpaqs…" />
        </label>
        <span>
          {filtered.length} {filtered.length === 1 ? "item" : "items"}
        </span>
      </div>
      <section className="work-list" aria-label="Recent Testpaqs">
        {filtered.map((item) => (
          <button className="work-row" key={item.id} onClick={() => onOpen(item.id)}>
            <span className="work-icon">
              <FileText size={18} />
            </span>
            <span className="work-main">
              <strong>{item.title}</strong>
              <span>
                {item.reference || "No ticket reference"} · Updated {formatRelative(item.updatedAt)}
              </span>
            </span>
            <span className={`status status-${item.status}`}>{label(item.status)}</span>
            <span className="count">
              <strong>{item.scenarioCount}</strong> scenarios
            </span>
            <span className={item.openQuestionCount ? "count attention" : "count"}>
              <strong>{item.openQuestionCount}</strong> open questions
            </span>
            <ArrowRight className="row-arrow" size={17} />
          </button>
        ))}
        {!filtered.length && (
          <div className="empty-state">
            <h2>{items.length ? "No matching Testpaqs" : "Start with a product change"}</h2>
            <p>
              {items.length
                ? "Try a different title or ticket reference."
                : "Paste a ticket, make its requirements explicit, then review suggested coverage."}
            </p>
            <Button icon={<Plus size={16} />} onClick={() => setNewOpen(true)}>
              Create your first Testpaq
            </Button>
            {config?.fixturesEnabled && (
              <div className="fixture-actions">
                <Button variant="secondary" size="sm" onClick={() => loadFixture("sample")}>
                  Load sample
                </Button>
                <Button variant="ghost" size="sm" onClick={() => loadFixture("stress")}>
                  Load 200-scenario fixture
                </Button>
              </div>
            )}
          </div>
        )}
      </section>
      <Dialog
        open={newOpen}
        onOpenChange={setNewOpen}
        title="Create a Testpaq"
        description="One focused packet of QA work for a product change."
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={!title.trim()}>
              Create Testpaq
            </Button>
          </>
        }
      >
        <label className="field">
          <span>Working title</span>
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") create();
            }}
            placeholder="e.g. Campaign amount visibility"
          />
        </label>
      </Dialog>
    </div>
  );
}
