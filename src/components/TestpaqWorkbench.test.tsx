import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFixture } from "../../server/fixture";
import { api, ApiError } from "../lib/api";
import type { Testpaq } from "../shared/domain";
import { TestpaqWorkbench } from "./TestpaqWorkbench";

vi.mock("../lib/api", () => ({
  api: { get: vi.fn(), groups: vi.fn(), save: vi.fn(), analyse: vi.fn(), config: vi.fn() },
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
  it("saves before refresh and sends recorded answers and existing scenarios", async () => {
    const item = makeFixture();
    vi.mocked(api.save).mockImplementation(async (snapshot) => ({ ...snapshot, updatedAt: "2026-10-01T12:00:00.000Z" }));
    vi.mocked(api.analyse).mockResolvedValue({
      item: { ...item, status: "in_review" },
      result: { requirements: [], scenarios: [], questions: [] },
      run: {} as never,
    });
    await load(item);
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Added scope" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh analysis" }));
    expect(api.analyse).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh analysis" }));
      await Promise.resolve();
    });
    expect(api.save).toHaveBeenCalled();
    expect(api.analyse).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket: expect.objectContaining({ description: "Added scope" }),
        questions: item.questions,
        scenarios: item.scenarios,
      }),
      expect.any(AbortSignal),
    );
  });
  it("shows billing guidance inside the still-open analysis dialog", async () => {
    const item = makeFixture();
    vi.mocked(api.analyse).mockRejectedValue(
      new ApiError(
        "OpenAI credits are exhausted. Add credits and retry.",
        "insufficient_quota",
        "https://platform.openai.com/settings/organization/billing/overview",
      ),
    );
    await load(item);
    fireEvent.click(screen.getByRole("button", { name: "Refresh analysis" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh analysis" }));
      await Promise.resolve();
    });
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("alert")).toHaveTextContent("OpenAI credits are exhausted");
    expect(dialog.getByRole("link", { name: "Open API billing ↗" })).toHaveAttribute(
      "href",
      "https://platform.openai.com/settings/organization/billing/overview",
    );
  });
});
