import type { AnalysisInput, AnalysisResult, AnalysisRun, Testpaq, TestpaqSummary } from "../shared/domain";

const token = document.querySelector<HTMLMetaElement>('meta[name="testpaq-session"]')?.content || "dev-session";

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
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string };
    throw new Error(body.error || `Request failed (${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  config: () => request<{ provider: string; model: string; configured: boolean; fixturesEnabled: boolean }>("/api/config"),
  list: () => request<TestpaqSummary[]>("/api/testpaqs"),
  get: (id: string) => request<Testpaq>(`/api/testpaqs/${id}`),
  create: (title: string) => request<Testpaq>("/api/testpaqs", { method: "POST", body: JSON.stringify({ title }) }),
  save: (item: Testpaq, keepalive = false) =>
    request<Testpaq>(`/api/testpaqs/${item.id}`, { method: "PUT", body: JSON.stringify(item), keepalive }),
  remove: (id: string) => request<void>(`/api/testpaqs/${id}`, { method: "DELETE" }),
  analyse: (input: AnalysisInput, signal?: AbortSignal) =>
    request<{ result: AnalysisResult; run: AnalysisRun }>("/api/analyse", {
      method: "POST",
      body: JSON.stringify(input),
      signal,
    }),
  history: (id: string) => request<AnalysisRun[]>(`/api/testpaqs/${id}/history`),
  fixture: (kind: "sample" | "stress") => request<Testpaq>(`/api/dev/fixtures/${kind}`, { method: "POST" }),
};
