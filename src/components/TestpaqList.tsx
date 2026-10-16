import { AlertCircle, ArrowRight, FileText, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppConfig } from "../App";
import { useRememberedState } from "../lib/remember";
import { api } from "../lib/api";
import { formatRelative, label } from "../lib/utils";
import type { TestpaqSummary, ProjectGroup } from "../shared/domain";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";

export function TestpaqList({ config, onOpen }: { config?: AppConfig; onOpen: (id: string) => void }) {
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const loadVersion = useRef(0);
  const [items, setItems] = useState<TestpaqSummary[]>([]);
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [groupFilter, setGroupFilter] = useRememberedState("workspace-group", "all", (value) => typeof value === "string");
  const [archiveView, setArchiveView] = useRememberedState("workspace-archive", "active", (value) =>
    ["active", "archived", "all"].includes(String(value)),
  );
  const [groupId, setGroupId] = useState("");
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [editingGroup, setEditingGroup] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useRememberedState("workspace-query", "", (value) => typeof value === "string" && value.length <= 300);
  const [newOpen, setNewOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(
    async (offset = 0) => {
      const version = ++loadVersion.current;
      setLoading(true);
      try {
        const [nextItems, nextGroups] = await Promise.all([
          api.list({ offset, query, group: groupFilter, archive: archiveView }),
          api.groups(),
        ]);
        if (version !== loadVersion.current) return;
        setError("");
        setItems((previous) => (offset ? [...previous, ...nextItems] : nextItems));
        setGroups(nextGroups);
        setHasMore(nextItems.length === 100);
      } catch (reason) {
        if (version === loadVersion.current) setError((reason as Error).message);
      } finally {
        if (version === loadVersion.current) setLoading(false);
      }
    },
    [query, groupFilter, archiveView],
  );
  useEffect(() => {
    const timer = setTimeout(() => void load(), 150);
    return () => {
      clearTimeout(timer);
      loadVersion.current += 1;
    };
  }, [load]);
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
  const changeArchive = async (item: TestpaqSummary) => {
    setBusy(true);
    setError("");
    try {
      await api.archive(item.id, !item.archived, item.updatedAt);
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const duplicate = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const copied = await api.duplicate(id);
      onOpen(copied.id);
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
          <h1>Your workspace</h1>
          <p>Start with a ticket. Clarify the scope, approve coverage and build your test cases.</p>
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
      <section className="workspace-guide" aria-label="How Testpaq works">
        <div>
          <span>1</span>
          <strong>Analyse a ticket</strong>
          <p>Paste the description and acceptance criteria.</p>
        </div>
        <div>
          <span>2</span>
          <strong>Confirm the scope</strong>
          <p>Review requirements and answer questions.</p>
        </div>
        <div>
          <span>3</span>
          <strong>Approve coverage</strong>
          <p>Choose the behaviours that need testing.</p>
        </div>
        <div>
          <span>4</span>
          <strong>Create test cases</strong>
          <p>Review steps, then export to Manual or Qase.</p>
        </div>
      </section>
      <div className="workspace-filters">
        <div className="group-toolbar">
          <label className="field">
            <span>Project group</span>
            <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
              <option value="all">All groups</option>
              <option value="ungrouped">Ungrouped</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          <details className="group-options">
            <summary>Manage groups</summary>
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
          </details>
        </div>
        <label className="field archive-view">
          <span>Workspace view</span>
          <select value={archiveView} onChange={(event) => setArchiveView(event.target.value)}>
            <option value="active">Active Testpaqs</option>
            <option value="archived">Archived Testpaqs</option>
            <option value="all">All Testpaqs</option>
          </select>
        </label>
      </div>
      <div className="list-toolbar">
        <label className="search">
          <Search size={16} />
          <span className="sr-only">Search Testpaqs</span>
          <input maxLength={300} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Testpaqs…" />
        </label>
        <span>
          {filtered.length} {filtered.length === 1 ? "item" : "items"}
          {hasMore ? " loaded" : ""}
        </span>
      </div>
      <section className="work-list" aria-label="Recent Testpaqs">
        {filtered.map((item) => (
          <div className="work-list-entry" key={item.id}>
            <button className="work-row" onClick={() => onOpen(item.id)}>
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
              <span className={`status status-${item.status}`}>{item.archived ? "Archived" : label(item.status)}</span>
              <span className="count">
                <strong>{item.scenarioCount}</strong> scenarios
              </span>
              <span className={item.openQuestionCount ? "count attention" : "count"}>
                <strong>{item.openQuestionCount}</strong> open questions
              </span>
              <ArrowRight className="row-arrow" size={17} />
            </button>
            <div className="work-row-actions">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={`Duplicate ${item.title}`}
                onClick={() => void duplicate(item.id)}
              >
                Duplicate
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={`${item.archived ? "Restore" : "Archive"} ${item.title}`}
                onClick={() => void changeArchive(item)}
              >
                {item.archived ? "Restore" : "Archive"}
              </Button>
            </div>
          </div>
        ))}
        {loading && <p role="status">Loading Testpaqs…</p>}
        {!loading && !filtered.length && (
          <div className="empty-state">
            <h2>{query || groupFilter !== "all" || archiveView !== "active" ? "No matching Testpaqs" : "Start with a product change"}</h2>
            <p>
              {query || groupFilter !== "all" || archiveView !== "active"
                ? "Try a different title or ticket reference."
                : "Paste a ticket, make its requirements explicit, then review suggested coverage."}
            </p>
            <Button icon={<Plus size={16} />} onClick={openCreate}>
              {query || groupFilter !== "all" || archiveView !== "active" ? "New Testpaq" : "Create your first Testpaq"}
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
      {hasMore && (
        <Button variant="secondary" disabled={loading} onClick={() => void load(items.length)}>
          Load more Testpaqs
        </Button>
      )}
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
            <Button variant="ghost" disabled={busy} onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={!title.trim() || busy}>
              Create Testpaq
            </Button>
          </>
        }
      >
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
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
