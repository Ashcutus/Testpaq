import { useState } from "react";
import { api } from "../lib/api";
import { Dialog } from "./ui/Dialog";
import { Button } from "./ui/Button";

export function WorkspaceSettings({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File>();
  const backup = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api.backup();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `testpaq-workspace-${data.createdAt.slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error("Backup must be smaller than 64 MB.");
      await api.restore(JSON.parse(await file.text()));
      // Saved drafts refer to the previous workspace and must not overwrite restored data.
      for (const key of Object.keys(localStorage)) if (key.startsWith("testpaq-draft:")) localStorage.removeItem(key);
      location.hash = "/";
      location.reload();
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
      closeDisabled={busy}
      title="Workspace backup"
      description="Keep a recoverable copy of your projects, Testpaqs and analysis history."
    >
      <Button disabled={busy} onClick={() => void backup()}>
        Download workspace backup
      </Button>
      <p>Backups contain ticket content and history, but never API keys. Store them somewhere you trust.</p>
      <label className="field">
        <span>Restore a Testpaq backup</span>
        <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => setFile(event.target.files?.[0])} />
      </label>
      {file && (
        <p className="warning-note">
          Restoring {file.name} replaces all projects, Testpaqs and history in this workspace. A local safety backup is created first. Other
          open tabs will need to reload.
        </p>
      )}
      <Button variant="danger" disabled={busy || !file} onClick={() => void restore()}>
        Replace workspace with selected backup
      </Button>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
