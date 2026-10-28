// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn(), constructor: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    responses = { create: mocks.create };
    models = { list: mocks.list };
    constructor(options: unknown) {
      mocks.constructor(options);
    }
  },
}));
import { OpenAIAnalysisProvider } from "./provider";
import { makeFixture, reviewedFixtureCase } from "./fixture";

beforeEach(() => {
  vi.clearAllMocks();
});

it("preserves conflicting answer scope and existing-case review, archive and freshness decisions", async () => {
  const item = makeFixture();
  const [first, second] = item.scenarios;
  const questions = [first, second].map((scenario, index) => ({
    id: crypto.randomUUID(),
    text: "Which role?",
    resolution: index ? "Administrator" : "Owner",
    scenarioId: scenario.id,
    origin: "human" as const,
    status: "resolved" as const,
    createdAt: new Date().toISOString(),
  }));
  const existing = reviewedFixtureCase({ ...item, questions }, first);
  mocks.create.mockResolvedValue({ output_text: '{"testCases":[]}' });
  const provider = new OpenAIAnalysisProvider("test-only-secret");
  const input = {
    testpaqId: item.id,
    ticket: item.ticket,
    requirements: item.requirements,
    questions,
    scenarios: [first, second],
    testCases: [existing],
    updateCaseIds: [],
  };
  await provider.draftCases(input);
  const firstSent = JSON.parse(mocks.create.mock.calls[0][0].input);
  await provider.draftCases({
    ...input,
    questions: questions.map((value, index) => ({ ...value, scenarioId: [second, first][index].id })),
    testCases: [{ ...existing, review: "rejected", archived: true }],
  });
  const secondSent = JSON.parse(mocks.create.mock.calls[1][0].input);
  expect(firstSent.answeredQuestions).not.toEqual(secondSent.answeredQuestions);
  expect(firstSent.answeredQuestions[0]).toMatchObject({
    questionId: questions[0].id,
    scenarioId: first.id,
    requirementId: null,
    answer: "Owner",
  });
  expect(secondSent.existingCases[0]).toMatchObject({ review: "rejected", archived: true, replacesCaseId: null });
  expect(firstSent.existingCases[0]).toMatchObject({ review: "accepted", archived: false, needsScopeReview: false });
  await provider.draftCases({ ...input, ticket: { ...item.ticket, qaContext: "Changed" } });
  expect(JSON.parse(mocks.create.mock.calls[2][0].input).existingCases[0].needsScopeReview).toBe(true);
});

it("rejects incomplete structured output instead of parsing a truncated paid response", async () => {
  mocks.create.mockResolvedValue({ status: "incomplete", output_text: '{"testCases":[]}' });
  const item = makeFixture();
  await expect(
    new OpenAIAnalysisProvider("test-only-secret").draftCases({
      testpaqId: item.id,
      ticket: item.ticket,
      requirements: item.requirements,
      scenarios: [item.scenarios[0]],
      testCases: [],
      updateCaseIds: [],
    }),
  ).rejects.toMatchObject({ code: "incomplete_output" });
  expect(mocks.create.mock.calls[0][0].max_output_tokens).toBe(16384);
});
describe("OpenAI provider boundary", () => {
  it("checks actual billable access rather than only listing models", async () => {
    const provider = new OpenAIAnalysisProvider("test-only-secret", "gpt-5-mini");
    mocks.create.mockResolvedValue({ output_text: "OK" });
    await provider.checkAccess();
    expect(mocks.create).toHaveBeenCalledWith({ model: "gpt-5-mini", input: "Reply with OK.", max_output_tokens: 32, store: false });
    expect(mocks.constructor).toHaveBeenCalledWith({ apiKey: "test-only-secret", timeout: 120_000, maxRetries: 0 });
  });
  it("lists account models on demand and switches model without replacing the key or changing an in-flight provider", async () => {
    const original = new OpenAIAnalysisProvider("test-only-secret", "old-model");
    const selected = original.withModel("new-model");
    mocks.list.mockResolvedValue({ data: [{ id: "z-model" }, { id: "a-model" }] });
    expect(await selected.listModels()).toEqual(["a-model", "z-model"]);
    mocks.create.mockResolvedValue({ output_text: "OK" });
    await selected.checkAccess();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ model: "new-model" }));
    expect(original.model).toBe("old-model");
    expect(mocks.constructor).toHaveBeenCalledOnce();
  });
  it("sends current answers and scenarios, disables stored responses and propagates billing errors", async () => {
    const item = makeFixture();
    const provider = new OpenAIAnalysisProvider("test-only-secret");
    const billingError = { status: 429, code: "insufficient_quota" };
    mocks.create.mockRejectedValue(billingError);
    await expect(
      provider.analyse({
        testpaqId: item.id,
        ticket: item.ticket,
        requirements: item.requirements,
        questions: item.questions,
        scenarios: item.scenarios,
      }),
    ).rejects.toBe(billingError);
    const request = mocks.create.mock.calls[0][0];
    expect(JSON.parse(request.input).existingRequirements[0]).toMatchObject({ active: item.requirements[0].active });
    expect(request.store).toBe(false);
    expect(JSON.parse(request.input)).toMatchObject({
      questionsAndAnswers: item.questions,
      existingScenarios: JSON.parse(JSON.stringify(item.scenarios)),
    });
    expect(request.input).not.toContain("test-only-secret");
  });
});

it("drafts cases for several coverage outputs in one request with only the context a tester needs", async () => {
  const item = makeFixture();
  const [first, second] = item.scenarios;
  const output = {
    testCases: [
      {
        clientId: "case1",
        scenarioId: first.id,
        replacesCaseId: null,
        title: "Hidden amount persists",
        description: "Verify stored visibility",
        preconditions: "Owner signed in",
        steps: [{ action: "Reload campaign", data: "", expectedResult: "Amount stays hidden" }],
      },
    ],
  };
  const parsed = { testCases: [{ ...output.testCases[0], replacesCaseId: undefined }] };
  mocks.create.mockResolvedValue({ output_text: JSON.stringify(output) });
  const provider = new OpenAIAnalysisProvider("test-only-secret", "selected-model");
  const input = {
    testpaqId: item.id,
    ticket: item.ticket,
    requirements: item.requirements.slice(0, 1),
    questions: item.questions,
    scenarios: [first, second],
    testCases: [],
    updateCaseIds: [],
  };
  expect(await provider.draftCases(input)).toEqual(parsed);
  const request = mocks.create.mock.calls[0][0];
  expect(request).toMatchObject({ store: false, model: "selected-model", text: { format: { name: "testpaq_test_cases", strict: true } } });
  const sent = JSON.parse(request.input);
  expect(sent.scenarios.map((value: { scenarioId: string }) => value.scenarioId)).toEqual([first.id, second.id]);
  expect(sent.answeredQuestions).toEqual([
    {
      questionId: item.questions[2].id,
      question: item.questions[2].text,
      answer: item.questions[2].resolution,
      scenarioId: null,
      requirementId: item.questions[2].requirementId,
    },
  ]);
  expect(request.input).not.toContain("test-only-secret");
  expect(request.instructions).toContain("Do not generate automation code");
  expect(request.instructions).toContain("No rationale");
});
