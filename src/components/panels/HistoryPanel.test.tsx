import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { makeFixture, reviewedFixtureCase } from "../../../server/fixture";
import { api } from "../../lib/api";
import type { AnalysisRun } from "../../shared/domain";
import { HistoryPanel } from "./HistoryPanel";

vi.mock("../../lib/api", () => ({ api: { history: vi.fn() } }));

it("keeps requested versus returned updates visible on a case drafting run", async () => {
  const item = makeFixture();
  const first = reviewedFixtureCase(item, item.scenarios[0]);
  const second = reviewedFixtureCase(item, item.scenarios[0]);
  const run = {
    id: crypto.randomUUID(),
    testpaqId: item.id,
    provider: "OpenAI",
    model: "test",
    promptVersion: "testpaq-test-cases-v3",
    status: "succeeded",
    disclosure: "Draft test cases",
    inputHash: "abc",
    inputSnapshot: { testpaqId: item.id, ticket: item.ticket, requirements: [], updateCaseIds: [first.id, second.id] },
    result: {
      testCases: [
        {
          clientId: "a",
          scenarioId: item.scenarios[0].id,
          replacesCaseId: first.id,
          title: "Revised",
          description: "Verify",
          preconditions: "",
          steps: [{ action: "Act", data: "", expectedResult: "Result" }],
        },
      ],
    },
    createdAt: new Date().toISOString(),
  } as unknown as AnalysisRun;
  vi.mocked(api.history).mockResolvedValue([run]);
  render(<HistoryPanel testpaqId={item.id} version={0} />);
  expect(await screen.findByText(/1 of 2 requested updates returned/)).toBeInTheDocument();
});

it("shows partial application and lets the user inspect returned drafts that could not be saved", async () => {
  const item = makeFixture();
  const target = reviewedFixtureCase(item, item.scenarios[0]);
  const run: AnalysisRun = {
    id: crypto.randomUUID(),
    testpaqId: item.id,
    provider: "OpenAI",
    model: "test",
    promptVersion: "testpaq-test-cases-v3",
    status: "succeeded",
    disclosure: "Draft test cases",
    inputHash: "abc",
    createdAt: new Date().toISOString(),
    result: {
      application: {
        added: 0,
        revised: 1,
        missingUpdateCaseIds: [],
        capacitySkippedNewCases: 1,
        capacitySkippedUpdateCaseIds: [target.id],
      },
      testCases: [
        {
          clientId: "0:0",
          replacesCaseId: undefined,
          scenarioId: target.scenarioId,
          title: "Unsaved draft",
          description: "Verify visibility",
          preconditions: "Owner signed in",
          steps: [{ action: "Reload campaign", data: "", expectedResult: "Amount stays hidden" }],
        },
      ],
    },
  };
  vi.mocked(api.history).mockResolvedValue([run]);
  render(<HistoryPanel testpaqId={item.id} version={0} />);
  expect(await screen.findByText(/0 new cases and 1 update proposals saved/)).toHaveTextContent(
    "3,000-case limit: 1 new cases and 1 update proposals not saved",
  );
  expect(screen.getByText("Partial")).toBeInTheDocument();
  fireEvent.click(screen.getByText("View returned drafts, including cases not saved"));
  expect(await screen.findByText("Unsaved draft")).toBeInTheDocument();
  expect(screen.getByText("Expected: Amount stays hidden")).toBeInTheDocument();
  expect(screen.queryByText(/not returned/)).toBeNull();
});

it("makes returned drafts inspectable after a later chunk fails, without claiming any were saved", async () => {
  const item = makeFixture();
  const run: AnalysisRun = {
    id: crypto.randomUUID(),
    testpaqId: item.id,
    provider: "OpenAI",
    model: "test",
    promptVersion: "testpaq-test-cases-v5",
    status: "failed",
    disclosure: "Drafting",
    inputHash: "abc",
    createdAt: new Date().toISOString(),
    errorCode: "provider_error",
    result: {
      incomplete: { completedChunks: 1, totalChunks: 2, reason: "provider_error" },
      testCases: [
        {
          clientId: "0:0",
          scenarioId: item.scenarios[0].id,
          replacesCaseId: undefined,
          title: "Retained draft",
          description: "Verify visibility",
          preconditions: "",
          steps: [{ action: "Reload", data: "", expectedResult: "Hidden" }],
        },
      ],
    },
  };
  vi.mocked(api.history).mockResolvedValue([run]);
  render(<HistoryPanel testpaqId={item.id} version={0} />);
  expect(await screen.findByText(/1 returned drafts retained; no cases saved/)).toHaveTextContent("1 of 2 AI requests completed");
  fireEvent.click(screen.getByText("View returned drafts, including cases not saved"));
  expect(await screen.findByText("Retained draft")).toBeInTheDocument();
});
