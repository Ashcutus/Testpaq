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
  const [draftModel, setModel] = useState<string>();
  const model = draftModel ?? config?.model ?? "gpt-5-mini";
  const [models, setModels] = useState<string[]>([]);
  const [key, setKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const check = async () => {
    setChecking(true);
    setError("");
    try {
      onConfig(await api.checkProvider(key.trim() || undefined, model.trim()));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setKey("");
      setChecking(false);
    }
  };
  const saveModel = async () => {
    setChecking(true);
    setError("");
    try {
      onConfig(await api.selectModel(model.trim()));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setChecking(false);
    }
  };
  const loadModels = async () => {
    setChecking(true);
    setError("");
    try {
      setModels(await api.models());
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setChecking(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!checking) {
          setKey("");
          setModel(undefined);
          onOpenChange(value);
        }
      }}
      closeDisabled={checking}
      title="OpenAI connection"
      description="Verify that the configured model can make a billable API request."
      footer={
        <Button onClick={check} disabled={checking || !model.trim() || (!config?.configured && !key.trim())}>
          {checking ? "Checking…" : key.trim() ? "Link and check key" : "Check API access"}
        </Button>
      }
    >
      <p>{config?.providerStatus.message || "Loading connection status…"}</p>
      <label className="field">
        <span>Analysis model</span>
        <input
          list="openai-models"
          value={model}
          maxLength={100}
          onChange={(event) => setModel(event.target.value)}
          disabled={checking}
          placeholder="Enter an OpenAI model ID"
        />
        <datalist id="openai-models">
          {models.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
      </label>
      <div className="button-group">
        <Button variant="secondary" onClick={saveModel} disabled={checking || !model.trim() || model.trim() === config?.model}>
          Save model
        </Button>
        <Button variant="ghost" onClick={loadModels} disabled={checking || !config?.configured}>
          Load available models
        </Button>
      </div>
      <p className="privacy-note">
        Choose from loaded models or enter a model ID. Selection is saved for future launches. Loading models sends an explicit request to
        OpenAI; availability does not guarantee support for structured analysis.
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
