import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProviderSettings } from "./ProviderSettings";
import { api } from "../lib/api";
vi.mock("../lib/api", () => ({ api: { selectModel: vi.fn(), models: vi.fn(), checkProvider: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
const config = {
  provider: "OpenAI",
  model: "initial-model",
  configured: true,
  fixturesEnabled: false,
  providerStatus: { status: "unchecked" as const, message: "Unchecked" },
};
it("loads model suggestions explicitly and saves selection without a billing check", async () => {
  const onConfig = vi.fn();
  vi.mocked(api.models).mockResolvedValue(["new-model"]);
  vi.mocked(api.selectModel).mockResolvedValue({ ...config, model: "new-model" });
  render(<ProviderSettings open onOpenChange={vi.fn()} config={config} onConfig={onConfig} />);
  expect(api.models).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Load available models" }));
  await waitFor(() => expect(document.querySelector('datalist option[value="new-model"]')).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Analysis model"), { target: { value: "new-model" } });
  fireEvent.click(screen.getByRole("button", { name: "Save model" }));
  await waitFor(() => expect(onConfig).toHaveBeenCalledWith(expect.objectContaining({ model: "new-model" })));
  expect(api.selectModel).toHaveBeenCalledWith("new-model");
  expect(api.checkProvider).not.toHaveBeenCalled();
});
it("checks access using the user-selected model with the existing key", async () => {
  vi.mocked(api.checkProvider).mockResolvedValue({ ...config, model: "custom-model" });
  render(<ProviderSettings open onOpenChange={vi.fn()} config={config} onConfig={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Analysis model"), { target: { value: "custom-model" } });
  fireEvent.click(screen.getByRole("button", { name: "Check API access" }));
  await waitFor(() => expect(api.checkProvider).toHaveBeenCalledWith(undefined, "custom-model"));
});
