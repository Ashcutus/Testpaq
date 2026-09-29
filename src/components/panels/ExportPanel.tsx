import { Check, Clipboard, Download, Eye } from "lucide-react";
import { useState } from "react";
import type { Testpaq } from "../../shared/domain";
import { Button } from "../ui/Button";

export function ExportPanel({ item, markdown, onExport }: { item: Testpaq; markdown: string; onExport: () => Promise<string> }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const copy = async () => {
    try {
      setError("");
      const content = await onExport();
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };
  const download = async () => {
    try {
      setError("");
      const content = await onExport();
      const href = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `${(item.ticket.reference || item.title).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-qa-coverage.md`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };
  return (
    <div className="panel-stack">
      <div className="content-heading">
        <div>
          <p className="eyebrow">Deterministic handoff</p>
          <h2>QA coverage brief</h2>
          <p>Generated from the reviewed local state—not from a fresh AI response.</p>
        </div>
        <div className="button-group">
          <Button variant="secondary" icon={copied ? <Check size={16} /> : <Clipboard size={16} />} onClick={() => void copy()}>
            {copied ? "Copied" : "Copy"}
          </Button>
          <button className="button button-primary button-md" onClick={() => void download()}>
            <Download size={16} />
            Download .md
          </button>
        </div>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <section className="export-summary">
        <span>
          <strong>{item.requirements.filter((value) => value.active).length}</strong> requirements
        </span>
        <span>
          <strong>{item.scenarios.filter((value) => value.review === "accepted").length}</strong> accepted
        </span>
        <span>
          <strong>{item.questions.filter((value) => value.status === "open").length}</strong> open questions
        </span>
      </section>
      <section className="markdown-preview">
        <div className="preview-label">
          <Eye size={15} />
          Markdown preview
        </div>
        <pre>{markdown}</pre>
      </section>
    </div>
  );
}
