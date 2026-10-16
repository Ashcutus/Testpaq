import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { makeFixture } from "../../../server/fixture";
import type { Testpaq } from "../../shared/domain";
import { TicketPanel } from "./TicketPanel";

function Harness({ initial }: { initial: Testpaq }) {
  const [item, setItem] = useState(initial);
  return (
    <>
      <TicketPanel view="requirements" item={item} update={(recipe) => setItem(recipe(structuredClone(item)))} onAnalyse={vi.fn()} />
      <output data-testid="requirements">{JSON.stringify(item.requirements)}</output>
    </>
  );
}
it("selects requirements for bulk decisions without including unfinished text in scope", () => {
  const item = makeFixture();
  item.requirements.push({ id: crypto.randomUUID(), text: "New requirement", source: "human", active: false, createdAt: item.createdAt });
  render(<Harness initial={item} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all requirements" }));
  expect(screen.getByRole("button", { name: "Approve selected requirements" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Decline selected requirements" }));
  let requirements = JSON.parse(screen.getByTestId("requirements").textContent!) as Testpaq["requirements"];
  expect(requirements.every((value) => !value.active)).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: `Select requirement ${item.requirements.length}` }));
  fireEvent.click(screen.getByRole("button", { name: "Approve selected requirements" }));
  requirements = JSON.parse(screen.getByTestId("requirements").textContent!) as Testpaq["requirements"];
  expect(requirements.slice(0, -1).every((value) => value.active)).toBe(true);
  expect(requirements.at(-1)?.active).toBe(false);
});
