import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFixture, reviewedFixtureCase } from "../../server/fixture";
import { api, ApiError } from "../lib/api";
import type { Testpaq } from "../shared/domain";
import { TestpaqWorkbench } from "./TestpaqWorkbench";

vi.mock("../lib/api", () => ({
  api: { get: vi.fn(), groups: vi.fn(), save: vi.fn(), analyse: vi.fn(), draftCases: vi.fn(), config: vi.fn() },
  ApiError: class extends Error {
    constructor(
      message: string,
      readonly code?: string,
      readonly billingUrl?: string,
    ) {
      super(message);
    }
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});
const config = {
  configured: true,
  provider: "OpenAI",
  model: "test",
  fixturesEnabled: false,
  providerStatus: { status: "unchecked" as const, message: "Key configured" },
};
async function load(item: Testpaq) {
  vi.mocked(api.get).mockResolvedValue(structuredClone(item));
  vi.mocked(api.groups).mockResolvedValue([]);
  render(<TestpaqWorkbench id={item.id} config={config} />);
  await act(async () => {
    await Promise.resolve();
  });
}

describe("workbench persistence", () => {
  it("serialises pending autosaves using the latest saved version without losing a newer edit", async () => {
    const item = makeFixture();
    let release!: (value: Testpaq) => void;
    vi.mocked(api.save)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockImplementation(async (snapshot) => ({ ...snapshot, updatedAt: "2026-10-01T12:00:01.000Z" }));
    await load(item);
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "First edit" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(650);
    });
    expect(api.save).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Second edit" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(650);
    });
    expect(api.save).toHaveBeenCalledOnce();
    const first = structuredClone(vi.mocked(api.save).mock.calls[0][0]);
    await act(async () => {
      release({ ...first, updatedAt: "2026-10-01T12:00:00.000Z" });
      await Promise.resolve();
    });
    expect(api.save).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.save).mock.calls[1][0]).toMatchObject({
      ticket: { description: "Second edit" },
      updatedAt: "2026-10-01T12:00:00.000Z",
    });
    expect(screen.getByLabelText("Description")).toHaveValue("Second edit");
    expect(screen.getByText("Saved locally")).toBeInTheDocument();
  });
  it("opens one Analyse dialog, runs nothing until chosen, and saves before sending recorded answers and scenarios", async () => {
    const item = makeFixture();
    vi.mocked(api.save).mockImplementation(async (snapshot) => ({ ...snapshot, updatedAt: "2026-10-01T12:00:00.000Z" }));
    vi.mocked(api.analyse).mockResolvedValue({
      item: { ...item, status: "in_review" },
      result: { requirements: [], scenarios: [], questions: [] },
      run: {} as never,
    });
    await load(item);
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Added scope" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyse" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(api.analyse).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("checkbox", { name: /Requirements, questions & coverage/ }));
    fireEvent.click(dialog.getByRole("checkbox", { name: /^Test cases/ }));
    await act(async () => {
      fireEvent.click(dialog.getByRole("button", { name: "Analyse" }));
      await Promise.resolve();
    });
    expect(api.save).toHaveBeenCalled();
    expect(api.draftCases).not.toHaveBeenCalled();
    expect(api.analyse).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket: expect.objectContaining({ description: "Added scope" }),
        questions: item.questions,
        scenarios: item.scenarios,
      }),
      expect.any(AbortSignal),
    );
  });
  it("drafts cases for every ticked approved coverage in one request without navigating", async () => {
    const item = makeFixture();
    vi.mocked(api.draftCases).mockResolvedValue({
      item,
      run: {} as never,
      added: 2,
      revised: 0,
      missingUpdateCaseIds: [],
      capacitySkippedNewCases: 0,
      capacitySkippedUpdateCaseIds: [],
    });
    await load(item);
    fireEvent.click(screen.getByRole("button", { name: "Analyse" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("checkbox", { name: /Requirements, questions & coverage/ })).not.toBeChecked();
    expect(dialog.getByRole("checkbox", { name: /^Test cases/ })).toBeChecked();
    fireEvent.click(dialog.getByRole("button", { name: "Select none" }));
    fireEvent.click(dialog.getByRole("checkbox", { name: new RegExp(item.scenarios[0].title) }));
    fireEvent.click(dialog.getByRole("checkbox", { name: new RegExp(item.scenarios[1].title) }));
    await act(async () => {
      fireEvent.click(dialog.getByRole("button", { name: "Analyse" }));
      await Promise.resolve();
    });
    expect(api.analyse).not.toHaveBeenCalled();
    expect(api.draftCases).toHaveBeenCalledOnce();
    expect(vi.mocked(api.draftCases).mock.calls[0][0]).toMatchObject({
      scenarioIds: [item.scenarios[0].id, item.scenarios[1].id],
      updateCaseIds: [],
    });
    expect(screen.getByRole("button", { name: /Initial ticket analysis/ })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(/Analysis finished: 2 test cases drafted/)).toBeInTheDocument();
  });
  it("marks the Analyse button out of date without a banner or prompt when the ticket changes", async () => {
    const item = makeFixture();
    const { analysisSignature } = await import("../shared/analysis");
    item.lastAnalysedSignature = analysisSignature(item);
    vi.mocked(api.save).mockImplementation(async (snapshot) => snapshot);
    await load(item);
    expect(screen.queryByRole("img", { name: /Out of date/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Changed after analysis" } });
    expect(screen.getByRole("img", { name: /Out of date/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Review coverage updates")).toBeNull();
  });
  it("discloses selected case drafting skipped after ticket analysis requires scope review", async () => {
    const { analysisSignature, applyAnalysis } = await import("../shared/analysis");
    const item = makeFixture();
    item.scenarios = [item.scenarios[0]];
    item.questions = [];
    item.lastAnalysedSignature = analysisSignature(item);
    item.ticket.description += " Changed scope";
    const refreshed = applyAnalysis(item, { requirements: [], scenarios: [], questions: [] }, crypto.randomUUID());
    vi.mocked(api.analyse).mockResolvedValue({
      item: refreshed,
      result: { requirements: [], scenarios: [], questions: [] },
      run: {} as never,
    });
    await load(item);
    fireEvent.click(screen.getByRole("button", { name: /^Analyse/ }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("checkbox", { name: /^Test cases/ }));
    await act(async () => {
      fireEvent.click(dialog.getByRole("button", { name: "Analyse" }));
      await Promise.resolve();
    });
    expect(api.draftCases).not.toHaveBeenCalled();
    expect(screen.getByText(/Analysis partly finished/)).toHaveTextContent(
      "Case drafting skipped for 1 selected coverage output needing scope review",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("preselects rejected-only coverage as needing cases", async () => {
    const item = makeFixture();
    item.scenarios = [item.scenarios[0]];
    item.questions = [];
    item.testCases = [{ ...reviewedFixtureCase(item, item.scenarios[0]), review: "rejected" }];
    await load(item);
    fireEvent.click(screen.getByRole("button", { name: "Analyse" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("checkbox", { name: /^Test cases/ })).toBeChecked();
    expect(dialog.getByRole("checkbox", { name: new RegExp(item.scenarios[0].title) })).toBeChecked();
    expect(dialog.getByRole("button", { name: "Analyse" })).toBeEnabled();
  });
  it("bounds Select all to the drafting API selection limit", async () => {
    const item = makeFixture();
    item.questions = [];
    item.scenarios = Array.from({ length: 201 }, (_, index) => ({
      ...item.scenarios[0],
      id: crypto.randomUUID(),
      title: `Coverage ${index}`,
    }));
    await load(item);
    fireEvent.click(screen.getByRole("button", { name: "Analyse" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "Select all" }));
    expect(dialog.getByText("200 selected · up to 200 per analysis")).toBeInTheDocument();
    expect(dialog.getByRole("checkbox", { name: /^Coverage 200/ })).toBeDisabled();
  });
  it("explains capacity skips without claiming returned revisions were missing", async () => {
    const item = makeFixture();
    vi.mocked(api.draftCases).mockResolvedValue({
      item,
      run: {} as never,
      added: 0,
      revised: 1,
      missingUpdateCaseIds: [],
      capacitySkippedNewCases: 2,
      capacitySkippedUpdateCaseIds: [crypto.randomUUID()],
    });
    await load(item);
    fireEvent.click(screen.getByRole("button", { name: "Analyse" }));
    const dialog = within(screen.getByRole("dialog"));
    await act(async () => {
      fireEvent.click(dialog.getByRole("button", { name: "Analyse" }));
      await Promise.resolve();
    });
    expect(screen.getByText(/Analysis partly finished/)).toHaveTextContent(
      "3,000-case limit prevented saving 2 new cases and 1 update proposal",
    );
    expect(screen.queryByText(/not returned/)).toBeNull();
  });
  it("keeps requirements analysis available at capacity without enabling case drafting", async () => {
    const item = makeFixture();
    const original = reviewedFixtureCase(item, item.scenarios[0]);
    item.testCases = Array.from({ length: 3000 }, () => ({ ...original, id: crypto.randomUUID() }));
    vi.mocked(api.analyse).mockResolvedValue({ item, result: { requirements: [], scenarios: [], questions: [] }, run: {} as never });
    await load(item);
    fireEvent.click(screen.getByRole("button", { name: "Analyse" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("checkbox", { name: /^Test cases/ })).toBeDisabled();
    expect(dialog.getByRole("checkbox", { name: /^Test cases/ })).not.toBeChecked();
    expect(dialog.getByText(/3,000-case limit is reached/)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("checkbox", { name: /Requirements, questions & coverage/ }));
    await act(async () => {
      fireEvent.click(dialog.getByRole("button", { name: "Analyse" }));
      await Promise.resolve();
    });
    expect(api.analyse).toHaveBeenCalledOnce();
    expect(api.draftCases).not.toHaveBeenCalled();
  });
  it("shows billing guidance inside the still-open Analyse dialog", async () => {
    const item = makeFixture();
    vi.mocked(api.analyse).mockRejectedValue(
      new ApiError(
        "OpenAI credits are exhausted. Add credits and retry.",
        "insufficient_quota",
        "https://platform.openai.com/settings/organization/billing/overview",
      ),
    );
    await load(item);
    fireEvent.click(screen.getByRole("button", { name: "Analyse" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("checkbox", { name: /Requirements, questions & coverage/ }));
    fireEvent.click(dialog.getByRole("checkbox", { name: /^Test cases/ }));
    await act(async () => {
      fireEvent.click(dialog.getByRole("button", { name: "Analyse" }));
      await Promise.resolve();
    });
    const open = within(screen.getByRole("dialog"));
    expect(open.getByRole("alert")).toHaveTextContent("OpenAI credits are exhausted");
    expect(open.getByRole("link", { name: "Open API billing ↗" })).toHaveAttribute(
      "href",
      "https://platform.openai.com/settings/organization/billing/overview",
    );
  });
});

it("persists completion, keeps export navigation available and reopens for editing", async () => {
  const item = makeFixture();
  item.testCases = [{ ...reviewedFixtureCase(item, item.scenarios[0]), review: "accepted" }];
  vi.mocked(api.save).mockImplementation(async (snapshot) => ({ ...snapshot, updatedAt: "2026-10-01T12:00:01.000Z" }));
  await load(item);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Mark completed" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Complete review" }));
  });
  expect(vi.mocked(api.save).mock.calls.at(-1)?.[0]).toMatchObject({ status: "completed", completedAt: expect.any(String) });
  expect(screen.getByLabelText("Description")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Coverage brief & handoff" }));
  expect(screen.getByRole("button", { name: "Download Qase CSV" })).toBeEnabled();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Reopen Testpaq" }));
  });
  expect(vi.mocked(api.save).mock.calls.at(-1)?.[0].status).toBe("in_review");
  expect(vi.mocked(api.save).mock.calls.at(-1)?.[0].completedAt).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Initial ticket analysis" }));
  expect(screen.getByLabelText("Description")).toBeEnabled();
});

it("does not display completion when saving the transition fails", async () => {
  vi.mocked(api.save).mockReset().mockRejectedValue(new Error("Database unavailable"));
  await load(makeFixture());
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Mark completed" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Complete review" }));
  });
  expect(screen.getByRole("button", { name: "Mark completed" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reopen Testpaq" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Description")).toBeEnabled();
  expect(screen.getByRole("alert")).toHaveTextContent("Database unavailable");
});

it("keeps approval separate from case creation and provides an explicit next stage", async () => {
  const item = makeFixture();
  const parent = item.scenarios.find((value) => value.review === "proposed")!;
  vi.mocked(api.save).mockImplementation(async (snapshot) => snapshot);
  await load(item);
  fireEvent.click(screen.getByRole("button", { name: /Coverage approval/ }));
  const row = screen.getAllByRole("listitem").find((value) => value.textContent?.includes(parent.title))!;
  fireEvent.click(within(row).getByRole("button", { name: "Accept scenario" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.analyse).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Continue to test cases" }));
  fireEvent.change(screen.getByLabelText("Coverage output"), { target: { value: parent.id } });
  expect(screen.getByLabelText("Coverage output")).toHaveValue(parent.id);
  expect(api.draftCases).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Add test case" }));
  expect(screen.getByLabelText("Test case title")).toHaveValue("New test case");
  expect(screen.getByLabelText("Qase CSV")).toBeInTheDocument();
  expect(screen.queryByLabelText("To be automated in Qase")).not.toBeInTheDocument();
});
