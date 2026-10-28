import { Check, Clipboard, Download, Eye } from "lucide-react";
import { useState } from "react";
import { caseNeedsReview } from "../../shared/test-cases";
import { workflowSummary } from "../../shared/workflow";
import { qaseCases } from "../../shared/qase";
import type { Testpaq } from "../../shared/domain";
import { Button } from "../ui/Button";

export function ExportPanel({
  item,
  markdown,
  onExport,
  onExported,
  onBusyChange,
  casesOnly = false,
}: {
  casesOnly?: boolean;
  item: Testpaq;
  markdown: string;
  onExport: (format: "markdown" | "manual" | "qase") => Promise<string>;
  onExported: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const cases = qaseCases(item);
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
  const download = async (format: "markdown" | "manual" | "qase") => {
    try {
      setWorking(true);
      setError("");
      const content = await onExport(format);
      const href = URL.createObjectURL(
        new Blob([content], { type: format === "qase" ? "text/csv;charset=utf-8" : "text/markdown;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `${(item.ticket.reference || item.title).toLowerCase().replace(/[^a-z0-9]+/g, "-")}${format === "qase" ? "-qase.csv" : format === "manual" ? "-manual-cases.md" : "-qa-coverage.md"}`;
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
    <div className={casesOnly ? "panel-stack case-handoff" : "panel-stack"}>
      {!casesOnly && (
        <>
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
        </>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {!casesOnly && (
        <>
          <section className="export-summary">
            <span>
              <strong>{item.requirements.filter((value) => value.active).length}</strong> requirements
            </span>
            <span>
              <strong>{item.scenarios.filter((value) => value.review === "accepted" && !value.archived).length}</strong> accepted coverage
              outputs
            </span>
            <span>
              <strong>{item.questions.filter((value) => value.status === "open").length}</strong> open questions
            </span>
          </section>
          <p>
            {(item.testCases ?? []).filter((value) => value.review === "accepted" && !value.archived).length} accepted test cases ·{" "}
            {(item.testCases ?? []).filter((value) => !value.archived && caseNeedsReview(item, value)).length} need scope review. Cases are
            handoff plans, not execution evidence.
          </p>
        </>
      )}
      {casesOnly && (
        <div>
          <h2>Export accepted tests</h2>
          <p>Download the accepted cases from this Testpaq. Drafts and cases needing scope review are excluded.</p>
        </div>
      )}
      <section className="handoff-section">
        <div className="content-heading">
          <div>
            <h2>Manual test cases</h2>
            <p>{workflowSummary(item).manual.length} reviewed, current cases ready for manual handoff.</p>
          </div>
          <Button
            disabled={busy || !workflowSummary(item).manual.length}
            icon={<Download size={16} />}
            onClick={() => void download("manual")}
          >
            Download manual cases
          </Button>
        </div>
        <p>Includes setup, ordered actions, data and expected results. This handoff records no execution results.</p>
      </section>
      <section className="handoff-section">
        <div className="content-heading">
          <div>
            <h2>Qase test cases</h2>
            <p>
              {cases.length} reviewed, current test cases selected for Qase;{" "}
              {cases.filter((scenario) => scenario.destinations.automation).length} to be automated.
            </p>
          </div>
          <Button disabled={busy || !cases.length} icon={<Download size={16} />} onClick={() => void download("qase")}>
            Download Qase CSV
          </Button>
        </div>
        <p>
          In your Qase project repository, choose Import Data → Qase.io CSV [deprecated] (the legacy format), upload the CSV and select a
          destination suite. Cases marked To be automated import as “To be automated”; other cases as manual. Case IDs are assigned by Qase.
          Reimporting creates new cases.
        </p>
        {cases.some((value) => value.destinations.automation) && (
          <p className="muted">
            Some cases retain an earlier To be automated plan. Clear and reselect Qase on a case to import it as manual.
          </p>
        )}
        {!cases.length && (
          <p>
            Create and accept linked test cases, then select Qase CSV or To be automated on each case. Coverage summaries are not exported
            as cases.
          </p>
        )}
        {cases.length > 0 && (
          <table className="export-cases">
            <thead>
              <tr>
                <th>Test case</th>
                <th>Coverage output</th>
                <th>Qase automation status</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((scenario) => (
                <tr key={scenario.id}>
                  <td>{scenario.title}</td>
                  <td>{item.scenarios.find((value) => value.id === scenario.scenarioId)?.title}</td>
                  <td>{scenario.destinations.automation ? "To be automated" : "Manual"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {!casesOnly && (
        <section className="markdown-preview">
          <div className="preview-label">
            <Eye size={15} />
            Markdown preview
          </div>
          <pre>{markdown}</pre>
        </section>
      )}
    </div>
  );
}
