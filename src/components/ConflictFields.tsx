import type { Testpaq } from "../shared/domain";
import { draftFieldLabel, draftValue } from "../lib/drafts";

export function ReadableValue({ value }: { value: unknown }) {
  if (value === undefined || value === null) return <em>Removed / not supplied</em>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "string" || typeof value === "number") return <p className="preserve-lines">{String(value) || "Empty"}</p>;
  if (Array.isArray(value))
    return value.length ? (
      <ol>
        {value.map((entry, index) => (
          <li key={index}>
            <ReadableValue value={entry} />
          </li>
        ))}
      </ol>
    ) : (
      <em>None</em>
    );
  return (
    <dl>
      {Object.entries(value as Record<string, unknown>)
        .filter(
          ([key]) =>
            ![
              "id",
              "sourceSignature",
              "replacesContentSignature",
              "createdAt",
              "updatedAt",
              "introducedInRun",
              "lastChangedInRun",
              "editedByHumanAt",
            ].includes(key),
        )
        .map(([key, entry]) => (
          <div key={key}>
            <dt>{key.replace(/([A-Z])/g, " $1")}</dt>
            <dd>
              <ReadableValue value={entry} />
            </dd>
          </div>
        ))}
    </dl>
  );
}
export function ConflictFields({
  local,
  remote,
  conflicts,
  choices,
  onChoose,
}: {
  local: Testpaq;
  remote: Testpaq;
  conflicts: string[];
  choices: Record<string, "local" | "saved">;
  onChoose: (path: string, side: "local" | "saved") => void;
}) {
  return (
    <div className="conflict-fields">
      {conflicts.map((path) => (
        <fieldset className="conflict-field" key={path}>
          <legend>{draftFieldLabel(local, path)}</legend>
          <div className="detail-grid">
            {(["local", "saved"] as const).map((side) => (
              <label className="conflict-option" key={side}>
                <span>
                  <input type="radio" name={path} checked={choices[path] === side} onChange={() => onChoose(path, side)} />{" "}
                  {side === "local" ? "Use my draft" : "Use saved change"}
                </span>
                <ReadableValue value={draftValue(side === "local" ? local : remote, path)} />
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
