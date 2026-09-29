import { z } from "zod";

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

export const RequirementSchema = z.object({
  id: z.uuid(),
  text: z.string().trim().min(1).max(4000),
  source: RequirementSourceSchema,
  active: z.boolean(),
  createdAt: z.iso.datetime(),
});

export const ScenarioSchema = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(300),
    expectedOutcome: z.string().trim().min(1).max(5000),
    origin: OriginSchema,
    category: CategorySchema,
    review: ReviewSchema,
    requirementIds: z.array(z.uuid()).max(50),
    rationale: z.string().trim().max(3000).optional(),
    risks: z.array(z.string().trim().min(1).max(1000)).max(20),
    destinations: z.object({ manual: z.boolean(), qase: z.boolean(), automation: z.boolean() }),
    editedByHumanAt: z.iso.datetime().optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .superRefine((scenario, context) => {
    if (scenario.origin === "explicit" && scenario.requirementIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["requirementIds"],
        message: "Explicit scenarios must link to at least one requirement.",
      });
    }
  });

export const QuestionSchema = z.object({
  id: z.uuid(),
  text: z.string().trim().min(1).max(3000),
  origin: OriginSchema,
  status: QuestionStatusSchema,
  requirementId: z.uuid().optional(),
  scenarioId: z.uuid().optional(),
  resolution: z.string().trim().max(3000).optional(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().optional(),
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
    status: z.enum(["draft", "in_review", "exported"]),
    ticket: TicketSchema,
    requirements: z.array(RequirementSchema).max(500),
    scenarios: z.array(ScenarioSchema).max(1000),
    questions: z.array(QuestionSchema).max(500),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    exportedAt: z.iso.datetime().optional(),
  })
  .superRefine((testpaq, context) => {
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
  ticket: TicketSchema,
  requirements: z.array(RequirementSchema).max(200),
});

export const AnalysisResultSchema = z
  .object({
    requirements: z.array(
      z.object({
        clientId: z.string().min(1).max(100),
        text: z.string().trim().min(1).max(4000),
        source: RequirementSourceSchema,
      }),
    ),
    scenarios: z.array(
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
    ),
    questions: z.array(
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
    ),
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

export type Testpaq = z.infer<typeof TestpaqSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type Requirement = z.infer<typeof RequirementSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type AnalysisInput = z.infer<typeof AnalysisInputSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export type TestpaqSummary = Pick<Testpaq, "id" | "title" | "status" | "createdAt" | "updatedAt"> & {
  reference: string;
  scenarioCount: number;
  openQuestionCount: number;
};

export type AnalysisRun = {
  id: string;
  testpaqId: string;
  provider: string;
  model: string;
  promptVersion: string;
  status: "running" | "succeeded" | "failed";
  disclosure: string;
  inputHash: string;
  result?: AnalysisResult;
  errorCode?: string;
  createdAt: string;
  completedAt?: string;
};
