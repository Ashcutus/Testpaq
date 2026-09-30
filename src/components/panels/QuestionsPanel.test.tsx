import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { makeFixture } from "../../../server/fixture";
import type { Testpaq } from "../../shared/domain";
import { QuestionsPanel } from "./QuestionsPanel";

function Harness({ onRefresh, onlyOne = false }: { onRefresh?: () => void; onlyOne?: boolean }) {
  const [item, setItem] = useState(() => {
    const fixture = makeFixture();
    if (onlyOne) fixture.questions = [fixture.questions[0]];
    return fixture;
  });
  return (
    <>
      <QuestionsPanel item={item} update={(recipe) => setItem((current) => recipe(structuredClone(current)))} onRefresh={onRefresh} />
      <output data-testid="state">{JSON.stringify(item)}</output>
    </>
  );
}
const state = () => JSON.parse(screen.getByTestId("state").textContent!) as Testpaq;

describe("question lifecycle", () => {
  it("requires an answer, saves it without creating a requirement and retains it on reopen", () => {
    render(<Harness />);
    const initialRequirements = state().requirements.length;
    expect(screen.getAllByText("Save answer")[0]).toBeDisabled();
    fireEvent.change(screen.getAllByLabelText(/^Answer to:/)[0], { target: { value: "Yes, include team pages." } });
    fireEvent.click(screen.getAllByText("Save answer")[0]);
    expect(state().questions[0]).toMatchObject({ status: "resolved", resolution: "Yes, include team pages." });
    expect(state().questions[0].resolvedAt).toBeTruthy();
    expect(state().requirements).toHaveLength(initialRequirements);
    fireEvent.click(screen.getByRole("button", { name: /Resolved/ }));
    fireEvent.click(screen.getAllByText("Reopen")[0]);
    expect(state().questions[0]).toMatchObject({ status: "open", resolution: "Yes, include team pages." });
  });
  it("offers refresh after the last answer, only proceeding when requested", () => {
    const refresh = vi.fn();
    render(<Harness onlyOne onRefresh={refresh} />);
    fireEvent.change(screen.getByLabelText(/^Answer to:/), { target: { value: "Yes." } });
    fireEvent.click(screen.getByText("Save answer"));
    expect(screen.getByRole("dialog")).toHaveTextContent("Questions answered");
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Refresh Testpaq"));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
