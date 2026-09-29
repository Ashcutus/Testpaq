import { ArrowLeft, Plus, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { TestpaqList } from "./components/TestpaqList";
import { TestpaqWorkbench } from "./components/TestpaqWorkbench";
import { ThemeControl } from "./components/ThemeControl";
import { Button } from "./components/ui/Button";
import { api } from "./lib/api";

export type AppConfig = Awaited<ReturnType<typeof api.config>>;

export function App() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || "/");
  const [config, setConfig] = useState<AppConfig>();
  useEffect(() => {
    const handler = () => setRoute(location.hash.slice(1) || "/");
    addEventListener("hashchange", handler);
    api
      .config()
      .then(setConfig)
      .catch(() => undefined);
    return () => removeEventListener("hashchange", handler);
  }, []);
  const id = route.startsWith("/testpaqs/") ? route.split("/")[2] : undefined;
  const go = (path: string) => {
    location.hash = path;
  };
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" onClick={() => go("/")} role="button" tabIndex={0}>
          <span>TESTPAQ</span>
          <span className="version">0.1</span>
        </div>
        <div className="topbar-actions">
          <span className="local-indicator">
            <ShieldCheck size={14} /> Local-only workspace
          </span>
          <ThemeControl />
        </div>
      </header>
      <main>
        {id ? (
          <>
            <div className="crumbbar">
              <Button variant="ghost" size="sm" icon={<ArrowLeft size={15} />} onClick={() => go("/")}>
                All Testpaqs
              </Button>
            </div>
            <TestpaqWorkbench id={id} config={config} />
          </>
        ) : (
          <TestpaqList config={config} onOpen={(itemId) => go(`/testpaqs/${itemId}`)} />
        )}
      </main>
      {!id && (
        <button className="mobile-create" aria-label="New Testpaq">
          <Plus />
        </button>
      )}
    </div>
  );
}
