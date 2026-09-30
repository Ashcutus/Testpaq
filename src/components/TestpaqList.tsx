import { AlertCircle, ArrowRight, FileText, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppConfig } from "../App";
import { api } from "../lib/api";
import { formatRelative, label } from "../lib/utils";
import type { TestpaqSummary, ProjectGroup } from "../shared/domain";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";

export function TestpaqList({ config, onOpen }: { config?: AppConfig; onOpen: (id: string) => void }) {
  const [items, setItems] = useState<TestpaqSummary[]>([]);
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [groupFilter, setGroupFilter] = useState("all");
  const [groupId, setGroupId] = useState("");
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [editingGroup, setEditingGroup] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const load = () =>
    Promise.all([api.list(), api.groups()])
      .then(([items, groups]) => {
        setItems(items);
        setGroups(groups);
      })
      .catch((reason: Error) => setError(reason.message));
  useEffect(() => {
    void load();
  }, []);
  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const item = await api.create(title, groupId || undefined);
      setNewOpen(false);
      onOpen(item.id);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
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
  const filtered = items.filter(
    (item) =>
      (groupFilter === "all" || (groupFilter === "ungrouped" ? !item.groupId : item.groupId === groupFilter)) &&
      `${item.title} ${item.reference}`.toLowerCase().includes(query.toLowerCase()),
  );
  const saveGroup = async () => {
    if (!groupName.trim() || busy) return;
    setBusy(true);
    try {
      if (editingGroup) await api.renameGroup(editingGroup, groupName);
      else await api.createGroup(groupName);
      setGroupOpen(false);
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const deleteGroup = async () => {
    if (!editingGroup || busy) return;
    setBusy(true);
    try {
      await api.removeGroup(editingGroup);
      setGroupFilter("all");
      setGroupId("");
      setGroupOpen(false);
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const openCreate = () => {
    setGroupId(groups.some((group) => group.id === groupFilter) ? groupFilter : "");
    setNewOpen(true);
  };
  return (
    <div className="page page-list">
      <section className="page-heading">
        <div>
          <p className="eyebrow">QA change review</p>
          <h1>Testpaqs</h1>
          <p>Turn product intent into reviewed, traceable coverage.</p>
        </div>
        <Button icon={<Plus size={16} />} onClick={openCreate}>
          New Testpaq
        </Button>
      </section>
      {error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={16} />
          {error}
        </div>
      )}
      <div className="group-toolbar">
        <label className="field">
          <span>Project group</span>
          <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
            <option value="all">All groups ({items.length})</option>
            <option value="ungrouped">Ungrouped ({items.filter((item) => !item.groupId).length})</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} ({items.filter((item) => item.groupId === group.id).length})
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="secondary"
          onClick={() => {
            setEditingGroup(undefined);
            setGroupName("");
            setGroupOpen(true);
          }}
        >
          New group
        </Button>
        {groups.some((group) => group.id === groupFilter) && (
          <Button
            variant="ghost"
            onClick={() => {
              setEditingGroup(groupFilter);
              setGroupName(groups.find((group) => group.id === groupFilter)!.name);
              setGroupOpen(true);
            }}
          >
            Manage group
          </Button>
        )}
      </div>
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
                {groups.find((group) => group.id === item.groupId)?.name || "Ungrouped"} · {item.reference || "No ticket reference"} ·
                Updated {formatRelative(item.updatedAt)}
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
            <Button icon={<Plus size={16} />} onClick={openCreate}>
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
        onOpenChange={(value) => {
          if (!busy) setNewOpen(value);
        }}
        closeDisabled={busy}
        title="Create a Testpaq"
        description="One focused packet of QA work for a product change."
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={!title.trim() || busy}>
              Create Testpaq
            </Button>
          </>
        }
      >
        <label className="field">
          <span>Working title</span>
          <input
            autoFocus
            maxLength={300}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") create();
            }}
            placeholder="e.g. Campaign amount visibility"
          />
        </label>
        <label className="field">
          <span>Project group</span>
          <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
            <option value="">Ungrouped</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
      </Dialog>
      <Dialog
        open={groupOpen}
        onOpenChange={(value) => {
          if (!busy) setGroupOpen(value);
        }}
        closeDisabled={busy}
        title={editingGroup ? "Manage project group" : "Create project group"}
        description="Group Testpaqs by project. Removing a group keeps its Testpaqs under Ungrouped."
        footer={
          <>
            {editingGroup && (
              <Button variant="ghost" onClick={deleteGroup} disabled={busy}>
                Remove group
              </Button>
            )}
            <Button onClick={saveGroup} disabled={!groupName.trim() || busy}>
              Save group
            </Button>
          </>
        }
      >
        <label className="field">
          <span>Group name</span>
          <input autoFocus maxLength={100} value={groupName} onChange={(event) => setGroupName(event.target.value)} />
        </label>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
      </Dialog>
    </div>
  );
}
