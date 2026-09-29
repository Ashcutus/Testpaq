import { Check, Clipboard, Download, Eye } from "lucide-react";
import { useState } from "react";
import type { Testpaq } from "../../shared/domain";
import { Button } from "../ui/Button";

export function ExportPanel({ item, markdown, onExport }: { item: Testpaq; markdown: string; onExport: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(markdown);
    onExport();
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  const href = `/api/testpaqs/${item.id}/export`;
  return (
    <div className="panel-stack">
      <div className="content-heading">
        <div>
          <p className="eyebrow">Deterministic handoff</p>
          <h2>QA coverage brief</h2>
          <p>Generated from the reviewed local state—not from a fresh AI response.</p>
        </div>
        <div className="button-group">
          <Button variant="secondary" icon={copied ? <Check size={16} /> : <Clipboard size={16} />} onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
          <a className="button button-primary button-md" href={href} download onClick={onExport}>
            <Download size={16} />
            Download .md
          </a>
        </div>
      </div>
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
