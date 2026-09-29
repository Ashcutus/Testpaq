import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeFixture } from "../../../server/fixture";
import { ReviewPanel } from "./ReviewPanel";

describe("scenario review", () => {
  it("exposes origin, destinations, and keyboard review", () => {
    let item = makeFixture();
    const update = vi.fn((recipe: (value: typeof item) => typeof item) => {
      item = recipe(structuredClone(item));
    });
    render(<ReviewPanel item={item} update={update} />);
    expect(screen.getAllByText("Explicit").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inferred").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("option")[0]);
    fireEvent.keyDown(window, { key: "r" });
    expect(update).toHaveBeenCalled();
  });
});
