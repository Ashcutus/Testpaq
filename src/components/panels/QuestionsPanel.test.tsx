import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { makeFixture } from "../../../server/fixture";
import type { Testpaq } from "../../shared/domain";
import { QuestionsPanel } from "./QuestionsPanel";

function Harness({ onlyOne = false }: { onlyOne?: boolean }) {
  const [item, setItem] = useState(() => {
    const fixture = makeFixture();
    if (onlyOne) fixture.questions = [fixture.questions[0]];
    return fixture;
  });
  return (
    <>
      <QuestionsPanel item={item} update={(recipe) => setItem((current) => recipe(structuredClone(current)))} />
      <output data-testid="state">{JSON.stringify(item)}</output>
    </>
  );
}
const state = () => JSON.parse(screen.getByTestId("state").textContent!) as Testpaq;

describe("question lifecycle", () => {
  it("reveals a newly added question from the resolved view", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^Resolved/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    expect(screen.getByDisplayValue("New QA question")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Open/ })).toHaveAttribute("aria-pressed", "true");
  });
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
  it("never prompts for analysis after an answer is saved", () => {
    render(<Harness onlyOne />);
    fireEvent.change(screen.getByLabelText(/^Answer to:/), { target: { value: "Yes." } });
    fireEvent.click(screen.getByText("Save answer"));
    expect(state().questions[0].status).toBe("resolved");
    expect(screen.queryByText("Questions answered")).toBeNull();
    expect(screen.queryByText(/Refresh Testpaq|Review affected cases/)).toBeNull();
  });
});
