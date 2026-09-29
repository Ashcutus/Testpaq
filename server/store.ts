import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  AnalysisInputSchema,
  AnalysisResultSchema,
  TestpaqSchema,
  type AnalysisRun,
  type Testpaq,
  type TestpaqSummary,
} from "../src/shared/domain.js";

type DatabaseInstance = InstanceType<typeof Database>;

export class TestpaqStore {
  readonly database: DatabaseInstance;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new Database(path);
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate() {
    const version = this.database.pragma("user_version", { simple: true }) as number;
    if (version < 1) {
      this.database.exec(`
        CREATE TABLE testpaqs (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          reference TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL CHECK(status IN ('draft', 'in_review', 'exported')),
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX testpaqs_updated_at_idx ON testpaqs(updated_at DESC);
        CREATE TABLE analysis_runs (
          id TEXT PRIMARY KEY,
          testpaq_id TEXT NOT NULL REFERENCES testpaqs(id) ON DELETE CASCADE,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          prompt_version TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed')),
          disclosure TEXT NOT NULL,
          input_hash TEXT NOT NULL,
          result_json TEXT,
          error_code TEXT,
          created_at TEXT NOT NULL,
          completed_at TEXT
        );
        CREATE INDEX analysis_runs_testpaq_idx ON analysis_runs(testpaq_id, created_at DESC);
        PRAGMA user_version = 1;
      `);
    }
    if (version < 2) {
      this.database.exec(`
        ALTER TABLE analysis_runs ADD COLUMN input_snapshot_json TEXT;
        PRAGMA user_version = 2;
      `);
    }
  }

  list(): TestpaqSummary[] {
    const rows = this.database.prepare("SELECT payload FROM testpaqs ORDER BY updated_at DESC").all() as Array<{ payload: string }>;
    return rows.map(({ payload }) => {
      const item = TestpaqSchema.parse(JSON.parse(payload));
      return {
        id: item.id,
        title: item.title,
        reference: item.ticket.reference,
        status: item.status,
        scenarioCount: item.scenarios.length,
        openQuestionCount: item.questions.filter((question) => question.status === "open").length,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    });
  }

  get(id: string): Testpaq | undefined {
    const row = this.database.prepare("SELECT payload FROM testpaqs WHERE id = ?").get(id) as { payload: string } | undefined;
    return row ? TestpaqSchema.parse(JSON.parse(row.payload)) : undefined;
  }

  save(input: Testpaq): Testpaq {
    const item = TestpaqSchema.parse(input);
    this.database
      .prepare(
        `INSERT INTO testpaqs (id, title, reference, status, payload, created_at, updated_at)
         VALUES (@id, @title, @reference, @status, @payload, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, reference=excluded.reference,
           status=excluded.status, payload=excluded.payload, updated_at=excluded.updated_at`,
      )
      .run({
        id: item.id,
        title: item.title,
        reference: item.ticket.reference,
        status: item.status,
        payload: JSON.stringify(item),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      });
    return item;
  }

  remove(id: string) {
    return this.database.prepare("DELETE FROM testpaqs WHERE id = ?").run(id).changes > 0;
  }

  startRun(run: Omit<AnalysisRun, "id" | "createdAt" | "status">): AnalysisRun {
    const value: AnalysisRun = { ...run, id: randomUUID(), status: "running", createdAt: new Date().toISOString() };
    this.database
      .prepare(
        `INSERT INTO analysis_runs
          (id, testpaq_id, provider, model, prompt_version, status, disclosure, input_hash, input_snapshot_json, created_at)
         VALUES (@id, @testpaqId, @provider, @model, @promptVersion, @status, @disclosure, @inputHash, @inputSnapshot, @createdAt)`,
      )
      .run({ ...value, inputSnapshot: value.inputSnapshot ? JSON.stringify(value.inputSnapshot) : null });
    return value;
  }

  finishRun(id: string, result: unknown): AnalysisRun {
    const parsed = AnalysisResultSchema.parse(result);
    const completedAt = new Date().toISOString();
    this.database
      .prepare("UPDATE analysis_runs SET status='succeeded', result_json=?, completed_at=? WHERE id=?")
      .run(JSON.stringify(parsed), completedAt, id);
    return this.getRun(id)!;
  }

  failRun(id: string, errorCode: string): AnalysisRun {
    const completedAt = new Date().toISOString();
    this.database
      .prepare("UPDATE analysis_runs SET status='failed', error_code=?, completed_at=? WHERE id=?")
      .run(errorCode, completedAt, id);
    return this.getRun(id)!;
  }

  getRuns(testpaqId: string): AnalysisRun[] {
    const rows = this.database
      .prepare("SELECT * FROM analysis_runs WHERE testpaq_id = ? ORDER BY created_at DESC")
      .all(testpaqId) as Record<string, string | null>[];
    return rows.map(mapRun);
  }

  private getRun(id: string): AnalysisRun | undefined {
    const row = this.database.prepare("SELECT * FROM analysis_runs WHERE id = ?").get(id) as Record<string, string | null> | undefined;
    return row ? mapRun(row) : undefined;
  }

  close() {
    this.database.close();
  }
}

function mapRun(row: Record<string, string | null>): AnalysisRun {
  return {
    id: row.id!,
    testpaqId: row.testpaq_id!,
    provider: row.provider!,
    model: row.model!,
    promptVersion: row.prompt_version!,
    status: row.status as AnalysisRun["status"],
    disclosure: row.disclosure!,
    inputHash: row.input_hash!,
    inputSnapshot: row.input_snapshot_json ? AnalysisInputSchema.parse(JSON.parse(row.input_snapshot_json)) : undefined,
    result: row.result_json ? AnalysisResultSchema.parse(JSON.parse(row.result_json)) : undefined,
    errorCode: row.error_code ?? undefined,
    createdAt: row.created_at!,
    completedAt: row.completed_at ?? undefined,
  };
}
