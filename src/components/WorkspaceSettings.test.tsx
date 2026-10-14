import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { WorkspaceSettings } from "./WorkspaceSettings";
vi.mock("../lib/api", () => ({ api: { backup: vi.fn() } }));
it("does not request a backup until pending edits save, and explains save failures in the dialog", async () => {
  let rejectSave!: (reason: Error) => void;
  const beforeBackup = vi.fn(
    () =>
      new Promise((_, reject) => {
        rejectSave = reject;
      }),
  );
  render(<WorkspaceSettings open onOpenChange={vi.fn()} beforeBackup={beforeBackup} />);
  fireEvent.click(screen.getByRole("button", { name: "Download workspace backup" }));
  expect(beforeBackup).toHaveBeenCalledOnce();
  expect(api.backup).not.toHaveBeenCalled();
  rejectSave(new Error("Save failed: resolve the local draft first"));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("resolve the local draft first"));
  expect(api.backup).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Download workspace backup" })).toBeEnabled();
});
