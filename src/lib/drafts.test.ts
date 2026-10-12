import { beforeEach, expect, it } from "vitest";
import { newTestCase } from "../shared/test-cases";
import { makeFixture } from "../../server/fixture";
import { mergeDraft, readDraft, writeDraft } from "./drafts";
beforeEach(() => localStorage.clear());
it("retains temporarily empty edits across reloads", () => {
  const base = makeFixture();
  const draft = structuredClone(base);
  draft.requirements[0].text = "";
  writeDraft(base, draft);
  expect(readDraft(base.id)?.draft.requirements[0].text).toBe("");
});
it("merges independent edits by entity ID and exposes contested fields", () => {
  const base = makeFixture();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.ticket.description = "Local description";
  remote.ticket.qaContext = "Remote context";
  const merged = mergeDraft(base, local, remote);
  expect(merged.conflicts).toEqual([]);
  expect(merged.item.ticket).toMatchObject({ description: "Local description", qaContext: "Remote context" });
  remote.ticket.description = "Remote description";
  expect(mergeDraft(base, local, remote).conflicts).toContain("ticket.description");
});
it("ignores malformed stored drafts without affecting server data", () => {
  localStorage.setItem("testpaq-draft:bad", '{"draft": {"id": "bad"}}');
  expect(readDraft("bad")).toBeUndefined();
});

it("merges independently added linked cases and requires renewed review of merged content", () => {
  const base = makeFixture();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.testCases = [newTestCase(local, local.scenarios[0])];
  remote.testCases = [newTestCase(remote, remote.scenarios[0])];
  expect(mergeDraft(base, local, remote).item.testCases).toHaveLength(2);
  const ticketOnly = structuredClone(base);
  ticketOnly.ticket.description = "Local ticket edit";
  expect(mergeDraft(base, ticketOnly, remote).item.testCases).toEqual(remote.testCases);
  base.testCases = [newTestCase(base, base.scenarios[0])];
  const edited = structuredClone(base);
  const reviewed = structuredClone(base);
  edited.testCases![0].steps[0].action = "Changed action";
  reviewed.testCases![0].review = "accepted";
  const merged = mergeDraft(base, edited, reviewed).item;
  expect(merged.testCases![0].steps[0].action).toBe("Changed action");
  expect(merged.testCases![0].review).toBe("proposed");
  edited.testCases![0].steps[0].action = "";
  writeDraft(base, edited);
  expect(readDraft(base.id)?.draft.testCases![0].steps[0].action).toBe("");
});
