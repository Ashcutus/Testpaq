import { TestpaqSchema, type AnalysisResult, type Testpaq } from "./domain.js";

const key = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
export function analysisSignature(item: Testpaq): string {
  return JSON.stringify({
    ticket: {
      reference: item.ticket.reference.trim(),
      title: item.ticket.title.trim(),
      description: item.ticket.description,
      acceptanceCriteria: item.ticket.acceptanceCriteria,
      qaContext: item.ticket.qaContext,
    },
    requirements: item.requirements.map(({ id, text, source, active }) => ({ id, text: text.trim(), source, active })),
    questions: item.questions.map(({ id, text, status, resolution, requirementId, scenarioId }) => ({
      id,
      text: text.trim(),
      status,
      resolution: resolution?.trim() || "",
      requirementId,
      scenarioId,
    })),
  });
}

/** Refresh suggestions without overwriting a human's edits, review, answers or provenance. */
export function applyAnalysis(input: Testpaq, result: AnalysisResult): Testpaq {
  const item = structuredClone(input);
  const timestamp = new Date(Math.max(Date.now(), Date.parse(input.updatedAt) + 1)).toISOString();
  const requirements = new Map<string, string>();
  for (const generated of result.requirements) {
    const existing = item.requirements.find((value) => key(value.text) === key(generated.text));
    if (existing) requirements.set(generated.clientId, existing.id);
    else {
      const id = crypto.randomUUID();
      requirements.set(generated.clientId, id);
      item.requirements.push({ id, text: generated.text, source: generated.source, active: true, createdAt: timestamp });
    }
  }
  const scenarios = new Map<string, string>();
  for (const generated of result.scenarios) {
    const existing = item.scenarios.find((value) => value.id === generated.clientId || key(value.title) === key(generated.title));
    const id = existing?.id || crypto.randomUUID();
    scenarios.set(generated.clientId, id);
    if (existing && (existing.review !== "proposed" || existing.editedByHumanAt || existing.origin === "human")) continue;
    const fields = {
      title: generated.title,
      expectedOutcome: generated.expectedOutcome,
      category: generated.category,
      requirementIds: generated.requirementClientIds.map((clientId) => requirements.get(clientId)!),
      rationale: generated.rationale,
      risks: generated.risks,
      updatedAt: timestamp,
    };
    if (existing) {
      // Historical origin remains truthful. Explicit coverage must keep a valid link.
      Object.assign(existing, fields);
      if (existing.origin === "explicit" && !existing.requirementIds.length) {
        existing.requirementIds = input.scenarios.find((value) => value.id === existing.id)!.requirementIds;
      }
    } else
      item.scenarios.push({
        ...fields,
        id,
        origin: generated.origin,
        review: "proposed",
        destinations: { manual: false, qase: false, automation: false },
        createdAt: timestamp,
      });
  }
  for (const generated of result.questions) {
    if (item.questions.some((value) => key(value.text) === key(generated.text))) continue;
    item.questions.push({
      id: crypto.randomUUID(),
      text: generated.text,
      origin: generated.origin,
      status: "open",
      requirementId: generated.requirementClientId ? requirements.get(generated.requirementClientId) : undefined,
      scenarioId: generated.scenarioClientId ? scenarios.get(generated.scenarioClientId) : undefined,
      createdAt: timestamp,
    });
  }
  item.status = "in_review";
  delete item.exportedAt;
  item.updatedAt = timestamp;
  item.lastAnalysedSignature = analysisSignature(item);
  return TestpaqSchema.parse(item);
}
