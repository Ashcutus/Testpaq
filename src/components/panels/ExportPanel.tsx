import { Check, Clipboard, Download, Eye } from "lucide-react";
import { useState } from "react";
import { qaseScenarios } from "../../shared/qase";
import type { Testpaq } from "../../shared/domain";
import { Button } from "../ui/Button";

export function ExportPanel({
  item,
  markdown,
  onExport,
  onExported,
  onBusyChange,
}: {
  item: Testpaq;
  markdown: string;
  onExport: (format: "markdown" | "qase") => Promise<string>;
  onExported: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const cases = qaseScenarios(item);
  const setWorking = (value: boolean) => {
    setBusy(value);
    onBusyChange(value);
  };
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const copy = async () => {
    try {
      setWorking(true);
      setError("");
      const content = await onExport("markdown");
      await navigator.clipboard.writeText(content);
      await onExported();
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setWorking(false);
    }
  };
  const download = async (format: "markdown" | "qase") => {
    try {
      setWorking(true);
      setError("");
      const content = await onExport(format);
      const href = URL.createObjectURL(
        new Blob([content], { type: format === "qase" ? "text/csv;charset=utf-8" : "text/markdown;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `${(item.ticket.reference || item.title).toLowerCase().replace(/[^a-z0-9]+/g, "-")}${format === "qase" ? "-qase.csv" : "-qa-coverage.md"}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      await onExported();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setWorking(false);
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
          <Button
            variant="secondary"
            icon={copied ? <Check size={16} /> : <Clipboard size={16} />}
            disabled={busy}
            onClick={() => void copy()}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <button className="button button-primary button-md" disabled={busy} onClick={() => void download("markdown")}>
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
          <strong>{item.scenarios.filter((value) => value.review === "accepted" && !value.archived).length}</strong> accepted
        </span>
        <span>
          <strong>{item.questions.filter((value) => value.status === "open").length}</strong> open questions
        </span>
      </section>
      <section className="panel-stack">
        <div className="content-heading">
          <div>
            <h2>Qase test cases</h2>
            <p>
              {cases.length} accepted cases selected for Qase or Cypress;{" "}
              {cases.filter((scenario) => scenario.destinations.automation).length} to be automated.
            </p>
          </div>
          <Button disabled={busy || !cases.length} icon={<Download size={16} />} onClick={() => void download("qase")}>
            Download Qase CSV
          </Button>
        </div>
        <p>
          In your Qase project repository, choose Import Data → Qase.io, upload the CSV and select a destination suite. Cypress cases import
          as “To be automated”; other cases as manual. Case IDs are assigned by Qase. Reimporting creates new cases.
        </p>
        {!cases.length && <p>Select Qase CSV or Cypress on accepted scenarios to include them here.</p>}
        {cases.length > 0 && (
          <table className="export-cases">
            <thead>
              <tr>
                <th>Test case</th>
                <th>Qase automation status</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((scenario) => (
                <tr key={scenario.id}>
                  <td>{scenario.title}</td>
                  <td>{scenario.destinations.automation ? "To be automated" : "Manual"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
