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
import { makeFixture } from "./fixture";

beforeEach(() => {
  vi.clearAllMocks();
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
