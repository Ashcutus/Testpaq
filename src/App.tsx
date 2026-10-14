import { ArrowLeft, KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TestpaqList } from "./components/TestpaqList";
import { TestpaqWorkbench } from "./components/TestpaqWorkbench";
import { ThemeControl } from "./components/ThemeControl";
import { Button } from "./components/ui/Button";
import { WorkspaceSettings } from "./components/WorkspaceSettings";
import { ProviderSettings } from "./components/ProviderSettings";
import { retainedDrafts } from "./lib/drafts";
import { downloadLocalData, observeWorkspace, retainSessionDraft, sessionDraftCopies, clearSessionDraftCopies } from "./lib/workspace";
import { Dialog } from "./components/ui/Dialog";
import type { Testpaq } from "./shared/domain";
import { api } from "./lib/api";

export type AppConfig = Awaited<ReturnType<typeof api.config>>;

export function App() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || "/");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configError, setConfigError] = useState("");
  const [config, setConfig] = useState<AppConfig>();
  const [hasSessionDraft, setHasSessionDraft] = useState(false);
  const [replaced, setReplaced] = useState(false);
  const [pendingRoute, setPendingRoute] = useState<string>();
  const [navigationError, setNavigationError] = useState("");
  const dirtyRef = useRef(false);
  const draftRef = useRef<(() => Testpaq | undefined) | undefined>(undefined);
  const routeRef = useRef(route);
  const navigationVersion = useRef(0);
  const prepareWorkspaceRef = useRef<(() => Promise<unknown>) | undefined>(undefined);
  useEffect(() => {
    const handler = async () => {
      const next = location.hash.slice(1) || "/";
      if (next === routeRef.current) return;
      const version = ++navigationVersion.current;
      try {
        if (dirtyRef.current) await prepareWorkspaceRef.current?.();
      } catch (reason) {
        if (version !== navigationVersion.current) return;
        setNavigationError((reason as Error).message);
        setPendingRoute(next);
        history.replaceState(null, "", `#${routeRef.current}`);
        return;
      }
      if (version !== navigationVersion.current) return;
      routeRef.current = next;
      setRoute(next);
    };
    addEventListener("hashchange", handler);
    api
      .config()
      .then(setConfig)
      .catch((reason: Error) => setConfigError(reason.message));
    const onReplaced = () => {
      if (dirtyRef.current) retainSessionDraft(draftRef.current?.());
      setReplaced(true);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === "testpaq-workspace-generation") observeWorkspace(event.newValue);
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (sessionDraftCopies().length) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    addEventListener("beforeunload", beforeUnload);
    addEventListener("testpaq-workspace-replaced", onReplaced);
    addEventListener("storage", onStorage);
    const timer = setInterval(() => {
      void api.config().catch(() => undefined);
    }, 3000);
    return () => {
      removeEventListener("beforeunload", beforeUnload);
      removeEventListener("hashchange", handler);
      removeEventListener("testpaq-workspace-replaced", onReplaced);
      removeEventListener("storage", onStorage);
      clearInterval(timer);
    };
  }, []);
  const id = route.startsWith("/testpaqs/") ? route.split("/")[2] : undefined;
  const go = (path: string) => {
    location.hash = path;
  };
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => go("/")}>
          <span>TESTPAQ</span>
          <span className="version">0.4</span>
        </button>
        <div className="topbar-actions">
          <span className="local-indicator">
            <ShieldCheck size={14} /> Local-only workspace
          </span>
          <Button variant="ghost" size="sm" icon={<KeyRound size={14} />} onClick={() => setSettingsOpen(true)}>
            {config?.providerStatus.status === "ready"
              ? "OpenAI verified"
              : config?.providerStatus.status === "error"
                ? "OpenAI needs attention"
                : config?.configured
                  ? "Check OpenAI"
                  : "Connect OpenAI"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setWorkspaceOpen(true)}>
            Backup / restore
          </Button>
          <ThemeControl />
        </div>
      </header>
      <main inert={replaced}>
        {hasSessionDraft && (
          <div className="warning-note" role="status">
            An unsaved draft is retained for this session. Download it before closing or reloading.
            <Button
              variant="secondary"
              onClick={() => {
                downloadLocalData(retainedDrafts(), "testpaq-retained-drafts.json");
                clearSessionDraftCopies();
                setHasSessionDraft(false);
              }}
            >
              Download retained drafts
            </Button>
          </div>
        )}
        {configError && (
          <div className="error-banner" role="alert">
            Could not load API configuration: {configError}
            <Button
              variant="secondary"
              onClick={() =>
                void api
                  .config()
                  .then((value) => {
                    setConfig(value);
                    setConfigError("");
                  })
                  .catch((reason: Error) => setConfigError(reason.message))
              }
            >
              Retry connection
            </Button>
          </div>
        )}
        {id ? (
          <>
            <div className="crumbbar">
              <Button variant="ghost" size="sm" icon={<ArrowLeft size={15} />} onClick={() => go("/")}>
                All Testpaqs
              </Button>
            </div>
            <TestpaqWorkbench
              key={id}
              id={id}
              config={config}
              onConfig={setConfig}
              onDirtyChange={(dirty) => {
                dirtyRef.current = dirty;
              }}
              registerDraft={(draft) => {
                draftRef.current = draft;
              }}
              registerSave={(save) => {
                prepareWorkspaceRef.current = save;
              }}
            />
          </>
        ) : (
          <TestpaqList config={config} onOpen={(itemId) => go(`/testpaqs/${itemId}`)} />
        )}
      </main>
      <WorkspaceSettings
        open={workspaceOpen}
        onOpenChange={setWorkspaceOpen}
        beforeBackup={async () => {
          await prepareWorkspaceRef.current?.();
        }}
        beforeRestore={async () => {
          await prepareWorkspaceRef.current?.();
        }}
      />
      <Dialog
        open={replaced}
        onOpenChange={() => undefined}
        closeDisabled
        title="Workspace replaced — editing paused"
        description="Another restore replaced this workspace. Your old tab cannot overwrite restored data."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                downloadLocalData({ currentDraft: draftRef.current?.(), retainedDrafts: retainedDrafts() }, "testpaq-retained-drafts.json")
              }
            >
              Download retained drafts
            </Button>
            <Button onClick={() => location.reload()}>Reload restored workspace</Button>
          </>
        }
      >
        <p>
          Download any unsaved work before reloading. The file contains ticket content. Keep it locally and copy wanted edits into the
          restored workspace after reviewing them.
        </p>
      </Dialog>
      <Dialog
        open={Boolean(pendingRoute)}
        onOpenChange={(open) => {
          if (!open) setPendingRoute(undefined);
        }}
        title="Your changes could not be saved"
        description="Your draft remains in this tab. Retry saving or download it before leaving."
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingRoute(undefined)}>
              Stay and fix save
            </Button>
            <Button variant="secondary" onClick={() => downloadLocalData(draftRef.current?.(), "testpaq-unsaved-draft.json")}>
              Download draft
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const next = pendingRoute!;
                dirtyRef.current = false;
                routeRef.current = next;
                setRoute(next);
                location.hash = next;
                setPendingRoute(undefined);
              }}
            >
              Leave with draft retained
            </Button>
          </>
        }
      >
        <p role="alert">{navigationError}</p>
      </Dialog>
      <ProviderSettings open={settingsOpen} onOpenChange={setSettingsOpen} config={config} onConfig={setConfig} />
    </div>
  );
}
