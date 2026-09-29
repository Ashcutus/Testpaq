import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeFixture } from "../../../server/fixture";
import { QuestionsPanel } from "./QuestionsPanel";

describe("question lifecycle", () => {
  it("resolves an open question without turning it into a requirement", () => {
    let item = makeFixture();
    const initialRequirements = item.requirements.length;
    const update = vi.fn((recipe: (value: typeof item) => typeof item) => {
      item = recipe(structuredClone(item));
    });
    render(<QuestionsPanel item={item} update={update} />);
    fireEvent.click(screen.getAllByText("Resolve")[0]);
    expect(item.questions[0].status).toBe("resolved");
    expect(item.questions[0].resolvedAt).toBeTruthy();
    expect(item.requirements).toHaveLength(initialRequirements);
  });
});
