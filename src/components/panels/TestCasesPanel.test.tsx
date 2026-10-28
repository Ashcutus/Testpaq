import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { makeFixture, reviewedFixtureCase } from "../../../server/fixture";
import type { Testpaq } from "../../shared/domain";
import { applyGeneratedCases, newTestCase } from "../../shared/test-cases";
import { TestCasesPanel } from "./TestCasesPanel";
function Harness({ initial, readOnly = false, initialFilter }: { initial: Testpaq; readOnly?: boolean; initialFilter?: string }) {
  const [item, setItem] = useState(initial);
  return (
    <>
      <TestCasesPanel
        item={item}
        update={(recipe) => setItem(recipe(structuredClone(item)))}
        selectedScenarioId={initialFilter}
        onSelect={vi.fn()}
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
  fireEvent.change(screen.getByLabelText("Action"), { target: { value: "Hide the campaign amount" } });
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
it("keeps converted legacy cases proposed until missing details are resolved and allows completed inspection", () => {
  const item = makeFixture();
  const legacy = newTestCase(item, item.scenarios[0], true);
  item.testCases = [legacy];
  const view = render(<Harness initial={item} />);
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
  item.testCases = [
    {
      ...reviewedFixtureCase(item, item.scenarios[0]),
      title: "Owner hides amount",
      steps: [{ id: crypto.randomUUID(), action: "Hide campaign amount", data: "", expectedResult: "Amount hidden" }],
      review: "accepted",
    },
  ];
  item.ticket.description += "Updated scope";
  render(<Harness initial={item} />);
  expect(screen.getByText("Review revised scope")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Accept current scope" }));
  expect(screen.queryByText("Review revised scope")).toBeNull();
});

it("keeps starter text from being accepted as a finished manual case", () => {
  render(<Harness initial={makeFixture()} />);
  fireEvent.click(screen.getByRole("button", { name: "Add test case" }));
  expect(screen.getByRole("button", { name: "Accept case" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Test case title"), { target: { value: "Owner hides amount" } });
  expect(screen.getByRole("button", { name: "Accept case" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Action"), { target: { value: "Select Hide amount" } });
  expect(screen.getByRole("button", { name: "Accept case" })).toBeEnabled();
});
it("clears historical Qase automation intent when Qase is deselected without changing acceptance", () => {
  const item = makeFixture();
  item.testCases = [
    {
      ...reviewedFixtureCase(item, item.scenarios[0]),
      title: "Owner hides amount",
      review: "accepted",
      destinations: { manual: true, qase: false, automation: true },
    },
  ];
  render(<Harness initial={item} />);
  expect(screen.getByLabelText("Qase CSV")).toBeChecked();
  fireEvent.click(screen.getByLabelText("Qase CSV"));
  const value = (JSON.parse(screen.getByTestId("state").textContent!) as Testpaq).testCases![0];
  expect(value).toMatchObject({ review: "accepted", destinations: { manual: true, qase: false, automation: false } });
});

it("compares and explicitly applies a generated revision before requiring case acceptance again", () => {
  const item = makeFixture();
  const original = { ...reviewedFixtureCase(item, item.scenarios[0]), title: "Original owner case", review: "accepted" as const };
  item.testCases = [original];
  const proposed = applyGeneratedCases(
    item,
    original.scenarioId,
    {
      testCases: [
        {
          clientId: "revision",
          title: "Clarified owner case",
          objective: "Verify clarified visibility",
          preconditions: "Owner signed in",
          postconditions: "",
          steps: [{ action: "Hide amount then reload", data: "Owner campaign", expectedResult: "Amount remains hidden" }],
          unknowns: [],
        },
      ],
    },
    crypto.randomUUID(),
    original.id,
  );
  render(<Harness initial={proposed} />);
  fireEvent.click(screen.getByRole("button", { name: /Clarified owner case.*Proposed update/ }));
  expect(screen.getByRole("region", { name: "Proposed case update" })).toHaveTextContent("Original owner case");
  expect(screen.getByRole("region", { name: "Proposed case update" })).toHaveTextContent("Clarified owner case");
  expect((JSON.parse(screen.getByTestId("state").textContent!) as Testpaq).testCases![0].title).toBe("Original owner case");
  fireEvent.click(screen.getByRole("button", { name: "Apply proposed update" }));
  const revised = (JSON.parse(screen.getByTestId("state").textContent!) as Testpaq).testCases!;
  expect(revised).toHaveLength(1);
  expect(revised[0]).toMatchObject({
    id: original.id,
    title: "Clarified owner case",
    review: "proposed",
    destinations: original.destinations,
  });
  fireEvent.click(screen.getByRole("button", { name: "Accept case" }));
  expect((JSON.parse(screen.getByTestId("state").textContent!) as Testpaq).testCases![0].review).toBe("accepted");
});

it("keeps a single editor while searching, filtering and navigating linked cases", () => {
  const item = makeFixture();
  item.testCases = [
    reviewedFixtureCase(item),
    { ...reviewedFixtureCase(item), id: crypto.randomUUID(), title: "Anonymous reader view", review: "proposed" },
  ];
  render(<Harness initial={item} />);
  expect(screen.getAllByLabelText("Test case title")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Next case" }));
  expect(screen.getByLabelText("Test case title")).toHaveValue("Anonymous reader view");
  expect(screen.queryByLabelText(/Postconditions/)).toBeNull();
  fireEvent.change(screen.getByLabelText("Case review filter"), { target: { value: "accepted" } });
  expect(screen.getByLabelText("Test case title")).toHaveValue(item.testCases[0].title);
  fireEvent.change(screen.getByLabelText("Search linked cases"), { target: { value: "nothing matches" } });
  expect(screen.getByText("No cases match these filters.")).toBeInTheDocument();
  expect(screen.queryByLabelText("Test case title")).not.toBeInTheDocument();
});

it("accepts the current draft and moves to the next draft without accepting it", () => {
  const item = makeFixture();
  item.testCases = [
    { ...reviewedFixtureCase(item), title: "First draft", review: "proposed" },
    { ...reviewedFixtureCase(item), id: crypto.randomUUID(), title: "Second draft", review: "proposed" },
  ];
  render(<Harness initial={item} />);
  fireEvent.click(screen.getByRole("button", { name: "Accept and review next" }));
  expect(screen.getByLabelText("Test case title")).toHaveValue("Second draft");
  const saved = JSON.parse(screen.getByTestId("state").textContent!) as Testpaq;
  expect(saved.testCases!.map((value) => value.review)).toEqual(["accepted", "proposed"]);
  fireEvent.click(screen.getByRole("button", { name: "Accept case" }));
  expect(screen.getByRole("button", { name: "Case accepted" })).toBeDisabled();
});

it("requires individual review of incomplete cases before allowing bulk approval", () => {
  const item = makeFixture();
  item.testCases = [
    { ...reviewedFixtureCase(item), title: "Ready case", review: "proposed" },
    {
      ...reviewedFixtureCase(item),
      id: crypto.randomUUID(),
      title: "Incomplete case",
      review: "proposed",
      unknowns: ["Confirm permissions"],
    },
  ];
  render(<Harness initial={item} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all test cases" }));
  expect(screen.getByRole("button", { name: "Approve selected cases" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select case: Incomplete case" }));
  fireEvent.click(screen.getByRole("button", { name: "Approve selected cases" }));
  let saved = JSON.parse(screen.getByTestId("state").textContent!) as Testpaq;
  expect(saved.testCases!.map((value) => value.review)).toEqual(["accepted", "proposed"]);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all test cases" }));
  fireEvent.click(screen.getByRole("button", { name: "Decline selected cases" }));
  saved = JSON.parse(screen.getByTestId("state").textContent!) as Testpaq;
  expect(saved.testCases!.every((value) => value.review === "rejected")).toBe(true);
});

it("lists cases from every coverage output together and adds new ones under the open case's coverage", () => {
  const item = makeFixture();
  item.testCases = [
    { ...reviewedFixtureCase(item, item.scenarios[0]), title: "First coverage case" },
    { ...reviewedFixtureCase(item, item.scenarios[1]), title: "Second coverage case" },
  ];
  render(<Harness initial={item} />);
  expect(screen.getByRole("button", { name: /First coverage case/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Second coverage case/ }));
  fireEvent.click(screen.getByRole("button", { name: "Add test case" }));
  const saved = JSON.parse(screen.getByTestId("state").textContent!) as Testpaq;
  expect(saved.testCases).toHaveLength(3);
  expect(saved.testCases![2].scenarioId).toBe(item.scenarios[1].id);
});

it("does not add a case under a filtered coverage that cannot take cases, so nothing is created out of view", () => {
  const item = makeFixture();
  const rejected = item.scenarios.find((value) => value.review === "rejected")!;
  item.testCases = [reviewedFixtureCase(item, item.scenarios[0])];
  render(<Harness initial={item} initialFilter={rejected.id} />);
  expect(screen.getByRole("button", { name: "Add test case" })).toBeDisabled();
  expect(screen.getByText(/cannot be added to it/)).toBeInTheDocument();
  expect((JSON.parse(screen.getByTestId("state").textContent!) as Testpaq).testCases).toHaveLength(1);
});
