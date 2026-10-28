import type {
  AnalysisInput,
  AnalysisResult,
  AnalysisRun,
  CaseApplication,
  Testpaq,
  TestpaqSummary,
  ProjectGroup,
  ProviderStatus,
} from "../shared/domain";

import { observeWorkspace, workspaceGeneration, workspaceReplaced } from "./workspace";
import { recordPatch } from "../shared/patch";
import { compactTestpaqSignatures } from "../shared/test-cases";

const token = document.querySelector<HTMLMetaElement>('meta[name="testpaq-session"]')?.content || "dev-session";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly billingUrl?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (workspaceReplaced())
    throw new ApiError("Workspace replaced. Download your retained draft and reload before continuing.", "workspace_replaced");
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(workspaceGeneration() ? { "x-testpaq-workspace": workspaceGeneration()! } : {}),
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.method && init.method !== "GET" ? { "x-testpaq-session": token } : {}),
      ...init?.headers,
    },
  });
  if (!observeWorkspace(response.headers.get("x-testpaq-workspace")) && path !== "/api/workspace/restore")
    throw new ApiError("Workspace replaced. Your draft is retained; reload before continuing.", "workspace_replaced");
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as {
      error?: string;
      code?: string;
      billingUrl?: string;
      issues?: Array<{ message: string }>;
    };
    throw new ApiError(
      [body.error || `Request failed (${response.status}).`, ...(body.issues ?? []).map((issue) => issue.message)].join(" "),
      body.code,
      body.billingUrl,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export type Config = { provider: string; model: string; configured: boolean; fixturesEnabled: boolean; providerStatus: ProviderStatus };
export const api = {
  backup: () => request<import("../shared/domain").WorkspaceBackup>("/api/workspace/backup", { method: "POST" }),
  restore: (backup: unknown) => request<{ restored: boolean }>("/api/workspace/restore", { method: "POST", body: JSON.stringify(backup) }),
  selectModel: (model: string) => request<Config>("/api/provider/model", { method: "PATCH", body: JSON.stringify({ model }) }),
  models: () => request<string[]>("/api/provider/models", { method: "POST" }),
  checkProvider: (apiKey?: string, model?: string) =>
    request<Config>("/api/provider/check", { method: "POST", body: JSON.stringify({ apiKey, model }) }),
  groups: () => request<ProjectGroup[]>("/api/groups"),
  createGroup: (name: string) => request<ProjectGroup>("/api/groups", { method: "POST", body: JSON.stringify({ name }) }),
  renameGroup: (id: string, name: string) => request<ProjectGroup>(`/api/groups/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),
  removeGroup: (id: string) => request<void>(`/api/groups/${id}`, { method: "DELETE" }),
  config: () => request<Config>("/api/config"),
  list: (options: { offset?: number; query?: string; group?: string; archive?: string } = {}) =>
    request<TestpaqSummary[]>(
      `/api/testpaqs?${new URLSearchParams({ offset: String(options.offset ?? 0), query: options.query ?? "", group: options.group ?? "all", archive: options.archive ?? "active" })}`,
    ),
  get: (id: string) => request<Testpaq>(`/api/testpaqs/${id}`),
  create: (title: string, groupId?: string) =>
    request<Testpaq>("/api/testpaqs", { method: "POST", body: JSON.stringify({ title, groupId }) }),
  save: (item: Testpaq, keepalive = false, base?: Testpaq) =>
    request<Testpaq>(`/api/testpaqs/${item.id}`, {
      method: base ? "PATCH" : "PUT",
      body: JSON.stringify(
        base
          ? { updatedAt: item.updatedAt, operations: recordPatch(compactTestpaqSignatures(base), compactTestpaqSignatures(item)) }
          : compactTestpaqSignatures(item),
      ),
      keepalive,
    }),
  archive: (id: string, archived: boolean, updatedAt: string) =>
    request<Testpaq>(`/api/testpaqs/${id}/archive`, { method: "PATCH", body: JSON.stringify({ archived, updatedAt }) }),
  duplicate: (id: string) => request<Testpaq>(`/api/testpaqs/${id}/duplicate`, { method: "POST" }),
  remove: (id: string) => request<void>(`/api/testpaqs/${id}`, { method: "DELETE" }),
  analyse: (input: AnalysisInput, signal?: AbortSignal) =>
    request<{ result: AnalysisResult; run: AnalysisRun; item: Testpaq }>("/api/analyse", {
      method: "POST",
      body: JSON.stringify(input),
      signal,
    }),
  draftCases: (
    input: { testpaqId: string; scenarioIds: string[]; updateCaseIds: string[]; updatedAt: string; model: string },
    signal?: AbortSignal,
  ) =>
    request<CaseApplication & { item: Testpaq; run: AnalysisRun }>("/api/test-cases/draft", {
      method: "POST",
      body: JSON.stringify(input),
      signal,
    }),
  history: (id: string, offset = 0) => request<AnalysisRun[]>(`/api/testpaqs/${id}/history?offset=${offset}`),
  fixture: (kind: "sample" | "stress") => request<Testpaq>(`/api/dev/fixtures/${kind}`, { method: "POST" }),
};
