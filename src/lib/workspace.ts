import type { Testpaq } from "../shared/domain";
let generation: string | undefined;
let replaced = false;
export const workspaceGeneration = () => generation;
export const workspaceReplaced = () => replaced;
export function observeWorkspace(next: string | null) {
  if (!next) return !replaced;
  if (!generation) generation = next;
  if (generation !== next && !replaced) {
    replaced = true;
    window.dispatchEvent(new Event("testpaq-workspace-replaced"));
  }
  try {
    localStorage.setItem("testpaq-workspace-generation", next);
  } catch {
    /* Server headers and polling remain authoritative. */
  }
  return !replaced;
}
export function downloadLocalData(value: unknown, name: string) {
  const href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

const sessionDrafts = new Map<string, Testpaq>();
export function retainSessionDraft(value?: Testpaq) {
  if (value) sessionDrafts.set(value.id, structuredClone(value));
}
export function sessionDraftCopies() {
  return [...sessionDrafts.values()].map((draft) => ({ key: `session:${draft.id}`, draft }));
}
export function clearSessionDraftCopies() {
  sessionDrafts.clear();
}
