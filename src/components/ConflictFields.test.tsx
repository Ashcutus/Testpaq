import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { makeFixture } from "../../server/fixture";
import { ConflictFields } from "./ConflictFields";
it("shows readable field choices without forcing a whole-document decision", () => {
  const local = makeFixture(),
    remote = structuredClone(local);
  local.ticket.description = "My description";
  remote.ticket.description = "Saved description";
  const choose = vi.fn();
  render(<ConflictFields local={local} remote={remote} conflicts={["ticket.description"]} choices={{}} onChoose={choose} />);
  expect(screen.getByRole("group", { name: "Ticket → Description" })).toHaveTextContent("My description");
  expect(screen.getByRole("group", { name: "Ticket → Description" })).toHaveTextContent("Saved description");
  fireEvent.click(screen.getByRole("radio", { name: /Use saved change/ }));
  expect(choose).toHaveBeenCalledWith("ticket.description", "saved");
});
