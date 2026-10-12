import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { makeFixture } from "../../../server/fixture";
import type { Testpaq } from "../../shared/domain";
import { newTestCase } from "../../shared/test-cases";
import { TestCasesPanel } from "./TestCasesPanel";
function Harness({ initial, readOnly = false }: { initial: Testpaq; readOnly?: boolean }) {
  const [item, setItem] = useState(initial);
  return (
    <>
      <TestCasesPanel
        item={item}
        update={(recipe) => setItem(recipe(structuredClone(item)))}
        onSelect={vi.fn()}
        onDraft={vi.fn()}
        readOnly={readOnly}
      />
      <output data-testid="state">{JSON.stringify(item)}</output>
    </>
  );
}
it("authors multiple cases under one output and requires review again after changing accepted steps", () => {
  const item = makeFixture();
  render(<Harness initial={item} />);
  fireEvent.click(screen.getByRole("button", { name: "Add test case" }));
  fireEvent.change(screen.getByLabelText("Test case title"), { target: { value: "Hide and reload" } });
  fireEvent.click(screen.getByRole("button", { name: "Add step" }));
  fireEvent.change(screen.getAllByLabelText("Action")[1], { target: { value: "Reload campaign" } });
  fireEvent.change(screen.getAllByLabelText("Expected result")[1], { target: { value: "Amount remains hidden" } });
  fireEvent.click(screen.getByRole("button", { name: "Accept case" }));
  let saved = JSON.parse(screen.getByTestId("state").textContent!) as Testpaq;
  expect(saved.testCases![0]).toMatchObject({ review: "accepted", scenarioId: item.scenarios[0].id });
  expect(saved.testCases![0].steps).toHaveLength(2);
  fireEvent.change(screen.getAllByLabelText("Expected result")[1], { target: { value: "Hidden for anonymous readers" } });
  saved = JSON.parse(screen.getByTestId("state").textContent!) as Testpaq;
  expect(saved.testCases![0].review).toBe("proposed");
  fireEvent.click(screen.getByRole("button", { name: "Add test case" }));
  saved = JSON.parse(screen.getByTestId("state").textContent!) as Testpaq;
  expect(saved.testCases).toHaveLength(2);
  expect(saved.testCases!.every((value) => value.scenarioId === item.scenarios[0].id)).toBe(true);
});
it("keeps legacy conversion proposed until missing details are resolved and allows completed inspection", () => {
  const item = makeFixture();
  const view = render(<Harness initial={item} />);
  fireEvent.click(screen.getByRole("button", { name: "Convert coverage to draft case" }));
  expect(screen.getByRole("button", { name: "Accept case" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Mark detail resolved" }));
  expect(screen.getByRole("button", { name: "Accept case" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Accept case" }));
  const saved = JSON.parse(screen.getByTestId("state").textContent!) as Testpaq;
  view.unmount();
  render(<Harness initial={{ ...saved, status: "completed" }} readOnly />);
  expect(screen.getByLabelText("Coverage output")).toBeEnabled();
  expect(screen.getByLabelText("Test case title")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Archive case" })).toBeDisabled();
});
it("exposes scope changes and reaccepts a reviewed case against the new scope", () => {
  const item = makeFixture();
  item.testCases = [{ ...newTestCase(item, item.scenarios[0]), review: "accepted" }];
  item.ticket.description += "Updated scope";
  render(<Harness initial={item} />);
  expect(screen.getByText("Review revised scope")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Accept current scope" }));
  expect(screen.queryByText("Review revised scope")).toBeNull();
});
