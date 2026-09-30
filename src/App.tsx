import { ArrowLeft, KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { TestpaqList } from "./components/TestpaqList";
import { TestpaqWorkbench } from "./components/TestpaqWorkbench";
import { ThemeControl } from "./components/ThemeControl";
import { Button } from "./components/ui/Button";
import { ProviderSettings } from "./components/ProviderSettings";
import { api } from "./lib/api";

export type AppConfig = Awaited<ReturnType<typeof api.config>>;

export function App() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || "/");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configError, setConfigError] = useState("");
  const [config, setConfig] = useState<AppConfig>();
  useEffect(() => {
    const handler = () => setRoute(location.hash.slice(1) || "/");
    addEventListener("hashchange", handler);
    api
      .config()
      .then(setConfig)
      .catch((reason: Error) => setConfigError(reason.message));
    return () => removeEventListener("hashchange", handler);
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
          <span className="version">0.2</span>
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
          <ThemeControl />
        </div>
      </header>
      <main>
        {configError && (
          <div className="error-banner" role="alert">
            Could not load API configuration: {configError}
          </div>
        )}
        {id ? (
          <>
            <div className="crumbbar">
              <Button variant="ghost" size="sm" icon={<ArrowLeft size={15} />} onClick={() => go("/")}>
                All Testpaqs
              </Button>
            </div>
            <TestpaqWorkbench key={id} id={id} config={config} onConfig={setConfig} />
          </>
        ) : (
          <TestpaqList config={config} onOpen={(itemId) => go(`/testpaqs/${itemId}`)} />
        )}
      </main>
      <ProviderSettings open={settingsOpen} onOpenChange={setSettingsOpen} config={config} onConfig={setConfig} />
    </div>
  );
}
