import { beforeEach, expect, it } from "vitest";
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
