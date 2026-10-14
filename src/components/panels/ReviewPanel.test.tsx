import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFixture } from "../../../server/fixture";
import { ReviewPanel } from "./ReviewPanel";

describe("scenario review", () => {
  afterEach(cleanup);
  it("exposes origin, destinations, and keyboard review", () => {
    let item = makeFixture();
    const update = vi.fn((recipe: (value: typeof item) => typeof item) => {
      item = recipe(structuredClone(item));
    });
    render(<ReviewPanel item={item} update={update} />);
    expect(screen.getAllByText("Explicit").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inferred").length).toBeGreaterThan(0);
    const row = screen.getAllByRole("listitem")[0];
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "r" });
    expect(update).toHaveBeenCalled();
  });

  it("labels destinations as candidates and supports unlinked filtering", () => {
    render(<ReviewPanel item={makeFixture()} update={vi.fn()} />);
    expect(screen.getAllByText("Qase CSV").length).toBeGreaterThan(0);
    expect(screen.queryByText("To be automated")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter by requirement coverage"), { target: { value: "unlinked" } });
    expect(screen.getByText(/shown · Suggestions remain proposals/)).toBeInTheDocument();
  });

  it("moves real keyboard focus between scenario rows", () => {
    render(<ReviewPanel item={makeFixture()} update={vi.fn()} />);
    const rows = screen.getAllByRole("listitem");
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
  });
});

it("undo reverses only affected scenarios and preserves unrelated newer edits", () => {
  let item = makeFixture();
  const update = (recipe: (value: typeof item) => typeof item) => {
    item = recipe(structuredClone(item));
  };
  const view = render(<ReviewPanel item={item} update={update} />);
  const row = screen.getAllByRole("listitem")[0];
  const before = item.scenarios[0].review;
  fireEvent.click(row);
  fireEvent.keyDown(row, { key: "r" });
  item.ticket.description = "New ticket context";
  view.rerender(<ReviewPanel item={item} update={update} />);
  fireEvent.click(screen.getByRole("button", { name: "Action applied · Undo" }));
  expect(item.ticket.description).toBe("New ticket context");
  expect(item.scenarios[0].review).toBe(before);
});

it("invalidates undo after a subsequent edit to an affected scenario", () => {
  let item = makeFixture();
  const update = (recipe: (value: typeof item) => typeof item) => {
    item = recipe(structuredClone(item));
  };
  const view = render(<ReviewPanel item={item} update={update} />);
  const row = screen.getAllByRole("listitem")[0];
  fireEvent.click(row);
  fireEvent.keyDown(row, { key: "r" });
  item.scenarios[0].expectedOutcome = "A newer human decision";
  view.rerender(<ReviewPanel item={item} update={update} />);
  expect(screen.queryByRole("button", { name: "Action applied · Undo" })).not.toBeInTheDocument();
});

it("allows completed scenario inspection and filtering while disabling edits", () => {
  const update = vi.fn();
  render(<ReviewPanel item={makeFixture()} update={update} readOnly />);
  fireEvent.click(screen.getAllByRole("button", { name: "Expand scenario" })[0]);
  expect(screen.getByLabelText("Scenario title")).toHaveAttribute("readonly");
  expect(screen.getAllByRole("button", { name: "Accept scenario" })[0]).toBeDisabled();
  expect(screen.getByRole("button", { name: "Archive scenario" })).toBeDisabled();
  expect(update).not.toHaveBeenCalled();
});
