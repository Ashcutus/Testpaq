import { useState } from "react";
import type { AppConfig } from "../App";
import { api } from "../lib/api";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";

export function ProviderSettings({
  open,
  onOpenChange,
  config,
  onConfig,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config?: AppConfig;
  onConfig: (config: AppConfig) => void;
}) {
  const [key, setKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const check = async () => {
    setChecking(true);
    setError("");
    try {
      onConfig(await api.checkProvider(key.trim() || undefined));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setKey("");
      setChecking(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!checking) {
          setKey("");
          onOpenChange(value);
        }
      }}
      closeDisabled={checking}
      title="OpenAI connection"
      description="Verify that the configured model can make a billable API request."
      footer={
        <Button onClick={check} disabled={checking || (!config?.configured && !key.trim())}>
          {checking ? "Checking…" : key.trim() ? "Link and check key" : "Check API access"}
        </Button>
      }
    >
      <p>{config?.providerStatus.message || "Loading connection status…"}</p>
      <p>
        Model: <strong>{config?.model || "gpt-5-mini"}</strong>
      </p>
      <label className="field">
        <span>API key for this session (optional)</span>
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="sk-…"
          disabled={checking}
        />
      </label>
      <p className="privacy-note">
        A linked key stays in the local server's memory until restart. For permanent configuration, put OPENAI_API_KEY in .env and restart
        with npm run run. Keys are never stored in your Testpaqs.
      </p>
      <p className="warning-note">
        This check sends “Reply with OK” and incurs a small API charge. It verifies access at this moment; it cannot report your exact
        remaining balance. ChatGPT Plus and API billing are separate.
      </p>
      <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noreferrer">
        Open OpenAI API billing ↗
      </a>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
    </Dialog>
  );
}
