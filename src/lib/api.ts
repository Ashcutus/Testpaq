import type { AnalysisInput, AnalysisResult, AnalysisRun, Testpaq, TestpaqSummary, ProjectGroup, ProviderStatus } from "../shared/domain";

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
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.method && init.method !== "GET" ? { "x-testpaq-session": token } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as {
      error?: string;
      code?: string;
      billingUrl?: string;
    };
    throw new ApiError(body.error || `Request failed (${response.status}).`, body.code, body.billingUrl);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export type Config = { provider: string; model: string; configured: boolean; fixturesEnabled: boolean; providerStatus: ProviderStatus };
export const api = {
  checkProvider: (apiKey?: string, model?: string) =>
    request<Config>("/api/provider/check", { method: "POST", body: JSON.stringify({ apiKey, model }) }),
  groups: () => request<ProjectGroup[]>("/api/groups"),
  createGroup: (name: string) => request<ProjectGroup>("/api/groups", { method: "POST", body: JSON.stringify({ name }) }),
  renameGroup: (id: string, name: string) => request<ProjectGroup>(`/api/groups/${id}`, { method: "PUT", body: JSON.stringify({ name }) }),
  removeGroup: (id: string) => request<void>(`/api/groups/${id}`, { method: "DELETE" }),
  config: () => request<Config>("/api/config"),
  list: () => request<TestpaqSummary[]>("/api/testpaqs"),
  get: (id: string) => request<Testpaq>(`/api/testpaqs/${id}`),
  create: (title: string, groupId?: string) =>
    request<Testpaq>("/api/testpaqs", { method: "POST", body: JSON.stringify({ title, groupId }) }),
  save: (item: Testpaq, keepalive = false) =>
    request<Testpaq>(`/api/testpaqs/${item.id}`, { method: "PUT", body: JSON.stringify(item), keepalive }),
  remove: (id: string) => request<void>(`/api/testpaqs/${id}`, { method: "DELETE" }),
  analyse: (input: AnalysisInput, signal?: AbortSignal) =>
    request<{ result: AnalysisResult; run: AnalysisRun; item: Testpaq }>("/api/analyse", {
      method: "POST",
      body: JSON.stringify(input),
      signal,
    }),
  history: (id: string) => request<AnalysisRun[]>(`/api/testpaqs/${id}/history`),
  fixture: (kind: "sample" | "stress") => request<Testpaq>(`/api/dev/fixtures/${kind}`, { method: "POST" }),
};
