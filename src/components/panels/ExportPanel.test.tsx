import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFixture, reviewedFixtureCase } from "../../../server/fixture";
import { ExportPanel } from "./ExportPanel";

afterEach(() => vi.restoreAllMocks());
describe("export handoff", () => {
  it("does not mark exported after a denied clipboard handoff", async () => {
    const onExported = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("Clipboard denied")) },
    });
    render(
      <ExportPanel
        item={makeFixture()}
        markdown="brief"
        onExport={vi.fn(async () => "brief")}
        onExported={onExported}
        onBusyChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Clipboard denied");
    expect(onExported).not.toHaveBeenCalled();
  });
  it("downloads the Qase format before recording export completion", async () => {
    const events: string[] = [];
    const onExport = vi.fn(async () => "v2.id,title\r\n");
    const onExported = vi.fn(async () => {
      events.push("recorded");
    });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      events.push(this.download);
    });
    const item = makeFixture();
    item.testCases = [{ ...reviewedFixtureCase(item, item.scenarios[0]), review: "accepted" }];
    render(<ExportPanel item={item} markdown="brief" onExport={onExport} onExported={onExported} onBusyChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Download Qase CSV" }));
    await waitFor(() => expect(onExported).toHaveBeenCalledOnce());
    expect(onExport).toHaveBeenCalledWith("qase");
    expect(events[0]).toMatch(/-qase.csv$/);
    expect(events[1]).toBe("recorded");
  });
});

it("offers case downloads inline while excluding unaccepted drafts", () => {
  const item = makeFixture();
  item.testCases = [
    reviewedFixtureCase(item),
    { ...reviewedFixtureCase(item), id: crypto.randomUUID(), title: "Unreviewed draft", review: "proposed" },
  ];
  render(<ExportPanel casesOnly item={item} markdown="brief" onExport={vi.fn()} onExported={vi.fn()} onBusyChange={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Download manual cases" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Download Qase CSV" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
  expect(screen.queryByText("Unreviewed draft")).not.toBeInTheDocument();
});
