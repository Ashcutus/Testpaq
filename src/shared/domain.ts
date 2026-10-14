import { z } from "zod";
import { caseContentIssues, isDraftText, scenarioContentIssues } from "./authoring.js";

export const RequirementSourceSchema = z.enum(["acceptance_criteria", "description", "human"]);
export const OriginSchema = z.enum(["explicit", "inferred", "human"]);
export const ReviewSchema = z.enum(["proposed", "accepted", "rejected"]);
export const CategorySchema = z.enum([
  "happy_path",
  "negative",
  "validation",
  "boundary",
  "regression",
  "api",
  "permissions",
  "persistence",
  "compatibility",
  "other",
]);
export const QuestionStatusSchema = z.enum(["open", "resolved", "dismissed"]);

export const RequirementFieldsSchema = z.object({
  id: z.uuid(),
  text: z.string().trim().max(4000),
  source: RequirementSourceSchema,
  active: z.boolean(),
  createdAt: z.iso.datetime(),
});
export const RequirementSchema = RequirementFieldsSchema.superRefine((value, context) => {
  if (value.active && isDraftText(value.text, "New requirement"))
    context.addIssue({ code: "custom", path: ["text"], message: "Finish requirement text before activating it." });
});

export const ScenarioFieldsSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().max(300),
  expectedOutcome: z.string().trim().max(5000),
  origin: OriginSchema,
  category: CategorySchema,
  review: ReviewSchema,
  requirementIds: z.array(z.uuid()).max(50),
  rationale: z.string().trim().max(3000).optional(),
  risks: z.array(z.string().trim().min(1).max(1000)).max(20),
  destinations: z.object({ manual: z.boolean(), qase: z.boolean(), automation: z.boolean() }),
  archived: z.boolean().optional(),
  scopeReviewRequired: z.boolean().optional(),
  introducedInRun: z.uuid().optional(),
  lastChangedInRun: z.uuid().optional(),
  editedByHumanAt: z.iso.datetime().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const ScenarioSchema = ScenarioFieldsSchema.superRefine((scenario, context) => {
  if (scenario.review === "accepted")
    for (const message of scenarioContentIssues(scenario)) context.addIssue({ code: "custom", path: ["review"], message });
  if (scenario.origin === "explicit" && scenario.requirementIds.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["requirementIds"],
      message: "Explicit scenarios must link to at least one requirement.",
    });
  }
});

export const TestStepSchema = z.object({
  id: z.uuid(),
  action: z.string().trim().max(5000),
  data: z.string().max(3000),
  expectedResult: z.string().trim().max(5000),
});
export const TestCaseFieldsSchema = z.object({
  id: z.uuid(),
  scenarioId: z.uuid(),
  title: z.string().trim().max(300),
  objective: z.string().trim().max(5000),
  preconditions: z.string().max(5000),
  postconditions: z.string().max(5000),
  steps: z.array(TestStepSchema).min(1).max(50),
  unknowns: z.array(z.string().trim().min(1).max(1000)).max(20),
  review: ReviewSchema,
  origin: z.enum(["generated", "human", "legacy"]),
  destinations: z.object({ manual: z.boolean(), qase: z.boolean(), automation: z.boolean() }),
  archived: z.boolean().optional(),
  sourceSignature: z.string().max(2000000),
  replacesCaseId: z.uuid().optional(),
  replacesContentSignature: z.string().max(2000000).optional(),
  lastChangedInRun: z.uuid().optional(),
  introducedInRun: z.uuid().optional(),
  editedByHumanAt: z.iso.datetime().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const TestCaseSchema = TestCaseFieldsSchema.superRefine((value, context) => {
  if (new Set(value.steps.map((step) => step.id)).size !== value.steps.length)
    context.addIssue({ code: "custom", path: ["steps"], message: "Duplicate step IDs." });
  if (value.review === "accepted") {
    for (const message of caseContentIssues(value)) context.addIssue({ code: "custom", path: ["review"], message });
    if (value.replacesCaseId)
      context.addIssue({ code: "custom", path: ["review"], message: "Apply a revision before accepting the original case." });
  }
  if (value.review === "accepted" && value.unknowns.length)
    context.addIssue({ code: "custom", path: ["unknowns"], message: "Resolve missing details before accepting a test case." });
});
export type TestCase = z.infer<typeof TestCaseSchema>;

export const QuestionFieldsSchema = z.object({
  id: z.uuid(),
  text: z.string().trim().max(3000),
  origin: OriginSchema,
  status: QuestionStatusSchema,
  requirementId: z.uuid().optional(),
  scenarioId: z.uuid().optional(),
  resolution: z.string().trim().max(3000).optional(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().optional(),
});
export const QuestionSchema = QuestionFieldsSchema.superRefine((value, context) => {
  if (value.status === "resolved" && (isDraftText(value.text, "New QA question") || !value.resolution?.trim()))
    context.addIssue({ code: "custom", path: ["resolution"], message: "Finish the question and answer before resolving it." });
});

export const TicketSchema = z.object({
  reference: z.string().trim().max(100),
  title: z.string().trim().max(300),
  description: z.string().max(30000),
  acceptanceCriteria: z.string().max(30000),
  qaContext: z.string().max(20000),
});

export const TestpaqSchema = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(300),
    groupId: z.uuid().optional(),
    archived: z.boolean().optional(),
    reviewNotice: z.string().max(1000).optional(),
    copiedFromId: z.uuid().optional(),
    lastAnalysedSignature: z.string().optional(),
    lastRefresh: z
      .object({
        added: z.array(z.uuid()).max(1000),
        changed: z.array(z.uuid()).max(1000),
        retained: z.array(z.uuid()).max(1000),
        affected: z.array(z.uuid()).max(1000),
        at: z.iso.datetime(),
      })
      .optional(),
    status: z.enum(["draft", "in_review", "exported", "completed"]),
    ticket: TicketSchema,
    requirements: z.array(RequirementSchema).max(500),
    scenarios: z.array(ScenarioSchema).max(1000),
    testCases: z.array(TestCaseSchema).max(3000).optional(),
    questions: z.array(QuestionSchema).max(500),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    exportedAt: z.iso.datetime().optional(),
    completedAt: z.iso.datetime().optional(),
  })
  .superRefine((testpaq, context) => {
    for (const key of ["requirements", "scenarios", "questions"] as const) {
      if (new Set(testpaq[key].map((value) => value.id)).size !== testpaq[key].length)
        context.addIssue({ code: "custom", path: [key], message: `Duplicate ${key} IDs.` });
    }
    for (const [index, scenario] of testpaq.scenarios.entries())
      if (new Set(scenario.requirementIds).size !== scenario.requirementIds.length)
        context.addIssue({ code: "custom", path: ["scenarios", index, "requirementIds"], message: "Duplicate requirement links." });
    if (new Set((testpaq.testCases ?? []).map((value) => value.id)).size !== (testpaq.testCases ?? []).length)
      context.addIssue({ code: "custom", path: ["testCases"], message: "Duplicate test case IDs." });
    for (const [index, value] of (testpaq.testCases ?? []).entries())
      if (!testpaq.scenarios.some((scenario) => scenario.id === value.scenarioId))
        context.addIssue({ code: "custom", path: ["testCases", index, "scenarioId"], message: "Unknown parent coverage output." });
    for (const [index, proposal] of (testpaq.testCases ?? []).entries()) {
      if (!proposal.replacesCaseId) continue;
      const target = testpaq.testCases?.find((value) => value.id === proposal.replacesCaseId);
      if (
        !target ||
        target.id === proposal.id ||
        target.replacesCaseId ||
        target.scenarioId !== proposal.scenarioId ||
        !proposal.replacesContentSignature
      )
        context.addIssue({
          code: "custom",
          path: ["testCases", index, "replacesCaseId"],
          message: "A revision must refer to an original case under the same coverage output and include its content snapshot.",
        });
    }
    const requirementIds = new Set(testpaq.requirements.map((item) => item.id));
    const scenarioIds = new Set(testpaq.scenarios.map((item) => item.id));
    for (const [index, scenario] of testpaq.scenarios.entries()) {
      for (const id of scenario.requirementIds) {
        if (!requirementIds.has(id)) {
          context.addIssue({ code: "custom", path: ["scenarios", index, "requirementIds"], message: "Unknown requirement link." });
        }
      }
    }
    for (const [index, question] of testpaq.questions.entries()) {
      if (question.requirementId && !requirementIds.has(question.requirementId)) {
        context.addIssue({ code: "custom", path: ["questions", index, "requirementId"], message: "Unknown requirement link." });
      }
      if (question.scenarioId && !scenarioIds.has(question.scenarioId)) {
        context.addIssue({ code: "custom", path: ["questions", index, "scenarioId"], message: "Unknown scenario link." });
      }
    }
  });

export const AnalysisInputSchema = z.object({
  testpaqId: z.uuid(),
  model: z.string().trim().min(1).max(100).optional(),
  ticket: TicketSchema,
  requirements: z.array(RequirementSchema).max(500),
  questions: z.array(QuestionSchema).max(500).optional(),
  scenarios: z.array(ScenarioSchema).max(1000).optional(),
  testCases: z.array(TestCaseSchema).max(3000).optional(),
  scenarioId: z.uuid().optional(),
  targetCaseId: z.uuid().optional(),
});

export const AnalysisResultSchema = z
  .object({
    requirements: z
      .array(
        z.object({
          clientId: z.string().min(1).max(100),
          text: z.string().trim().min(1).max(4000),
          source: RequirementSourceSchema,
        }),
      )
      .max(500),
    scenarios: z
      .array(
        z.object({
          clientId: z.string().min(1).max(100),
          title: z.string().trim().min(1).max(300),
          expectedOutcome: z.string().trim().min(1).max(5000),
          origin: z.enum(["explicit", "inferred"]),
          category: CategorySchema,
          requirementClientIds: z.array(z.string().min(1)).max(50),
          rationale: z
            .string()
            .trim()
            .max(3000)
            .optional()
            .nullable()
            .transform((value) => value ?? undefined),
          risks: z.array(z.string().trim().min(1).max(1000)).max(20),
        }),
      )
      .max(1000),
    questions: z
      .array(
        z.object({
          text: z.string().trim().min(1).max(3000),
          origin: z.enum(["explicit", "inferred"]),
          requirementClientId: z
            .string()
            .min(1)
            .optional()
            .nullable()
            .transform((value) => value ?? undefined),
          scenarioClientId: z
            .string()
            .min(1)
            .optional()
            .nullable()
            .transform((value) => value ?? undefined),
        }),
      )
      .max(500),
  })
  .superRefine((result, context) => {
    const requirementIds = new Set(result.requirements.map((item) => item.clientId));
    const scenarioIds = new Set(result.scenarios.map((item) => item.clientId));
    if (requirementIds.size !== result.requirements.length || scenarioIds.size !== result.scenarios.length) {
      context.addIssue({ code: "custom", message: "Analysis returned duplicate client IDs." });
    }
    for (const [index, scenario] of result.scenarios.entries()) {
      if (scenario.origin === "explicit" && scenario.requirementClientIds.length === 0) {
        context.addIssue({ code: "custom", path: ["scenarios", index], message: "Explicit scenario has no requirement." });
      }
      if (scenario.requirementClientIds.some((id) => !requirementIds.has(id))) {
        context.addIssue({ code: "custom", path: ["scenarios", index], message: "Scenario references an unknown requirement." });
      }
    }
    for (const [index, question] of result.questions.entries()) {
      if (question.requirementClientId && !requirementIds.has(question.requirementClientId)) {
        context.addIssue({ code: "custom", path: ["questions", index], message: "Question references an unknown requirement." });
      }
      if (question.scenarioClientId && !scenarioIds.has(question.scenarioClientId)) {
        context.addIssue({ code: "custom", path: ["questions", index], message: "Question references an unknown scenario." });
      }
    }
  });

export const CaseGenerationInputSchema = AnalysisInputSchema.extend({
  scenarioId: z.uuid(),
  scenarios: z.array(ScenarioSchema).length(1),
  testCases: z.array(TestCaseSchema).max(3000),
});
export const CaseGenerationResultSchema = z
  .object({
    testCases: z
      .array(
        z.object({
          clientId: z.string().trim().min(1).max(100),
          title: z.string().trim().min(1).max(300),
          objective: z.string().trim().min(1).max(5000),
          preconditions: z.string().max(5000),
          postconditions: z.string().max(5000),
          steps: z
            .array(TestStepSchema.omit({ id: true }))
            .min(1)
            .max(50),
          unknowns: z.array(z.string().trim().min(1).max(1000)).max(20),
        }),
      )
      .max(30),
  })
  .superRefine((value, context) => {
    if (new Set(value.testCases.map((item) => item.clientId)).size !== value.testCases.length)
      context.addIssue({ code: "custom", message: "Duplicate generated test case IDs." });
  });
export const AnalysisRunResultSchema = z.union([AnalysisResultSchema, CaseGenerationResultSchema]);
export type CaseGenerationInput = z.infer<typeof CaseGenerationInputSchema>;
export type CaseGenerationResult = z.infer<typeof CaseGenerationResultSchema>;

export type Testpaq = z.infer<typeof TestpaqSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type Requirement = z.infer<typeof RequirementSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type AnalysisInput = z.infer<typeof AnalysisInputSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export type TestpaqSummary = Pick<Testpaq, "id" | "title" | "groupId" | "status" | "createdAt" | "updatedAt" | "archived"> & {
  reference: string;
  scenarioCount: number;
  openQuestionCount: number;
};

// Historical inputs retain their recorded decisions; current authoring rules do not rewrite history.
export const HistoricalAnalysisInputSchema = AnalysisInputSchema.extend({
  requirements: z.array(RequirementFieldsSchema).max(500),
  scenarios: z.array(ScenarioFieldsSchema).max(1000).optional(),
  questions: z.array(QuestionFieldsSchema).max(500).optional(),
  testCases: z.array(TestCaseFieldsSchema).max(3000).optional(),
});
export const AnalysisRunSchema = z.object({
  id: z.uuid(),
  testpaqId: z.uuid(),
  provider: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  promptVersion: z.string().min(1).max(100),
  status: z.enum(["running", "succeeded", "failed"]),
  disclosure: z.string().max(10000),
  inputHash: z.string().max(100),
  inputSnapshot: HistoricalAnalysisInputSchema.optional(),
  result: AnalysisRunResultSchema.optional(),
  errorCode: z.string().max(100).optional(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
});
export type AnalysisRun = z.infer<typeof AnalysisRunSchema>;
export const WorkspaceBackupSchema = z
  .object({
    format: z.literal("testpaq-workspace"),
    version: z.literal(1),
    createdAt: z.iso.datetime(),
    groups: z.array(z.object({ id: z.uuid(), name: z.string().trim().min(1).max(100) })).max(10000),
    testpaqs: z.array(TestpaqSchema).max(10000),
    runs: z.array(AnalysisRunSchema).max(100000),
    model: z.string().trim().min(1).max(100).optional(),
  })
  .superRefine((backup, context) => {
    for (const key of ["groups", "testpaqs", "runs"] as const)
      if (new Set(backup[key].map((value) => value.id)).size !== backup[key].length)
        context.addIssue({ code: "custom", path: [key], message: "Duplicate backup IDs." });
    if (new Set(backup.groups.map((group) => group.name.toLowerCase())).size !== backup.groups.length)
      context.addIssue({ code: "custom", path: ["groups"], message: "Duplicate group names." });
    const groups = new Set(backup.groups.map((group) => group.id));
    const items = new Set(backup.testpaqs.map((item) => item.id));
    if (backup.testpaqs.some((item) => item.groupId && !groups.has(item.groupId)))
      context.addIssue({ code: "custom", path: ["testpaqs"], message: "Unknown backup group." });
    if (backup.runs.some((run) => !items.has(run.testpaqId) || (run.inputSnapshot && run.inputSnapshot.testpaqId !== run.testpaqId)))
      context.addIssue({ code: "custom", path: ["runs"], message: "Unknown or inconsistent analysis owner." });
  });
export type WorkspaceBackup = z.infer<typeof WorkspaceBackupSchema>;

export type ProjectGroup = { id: string; name: string };
export type ProviderStatus = {
  status: "unconfigured" | "unchecked" | "ready" | "error";
  message: string;
  code?: string;
  billingUrl?: string;
  checkedAt?: string;
};
