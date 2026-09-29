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
    expect(screen.getAllByText("Qase candidate").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Automation candidate").length).toBeGreaterThan(0);
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
