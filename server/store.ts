import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  WorkspaceBackupSchema,
  type WorkspaceBackup,
  HistoricalAnalysisInputSchema,
  AnalysisRunResultSchema,
  TestpaqSchema,
  type AnalysisRun,
  type Testpaq,
  type TestpaqSummary,
} from "../src/shared/domain.js";

import { caseContentIssues, isDraftText, scenarioContentIssues } from "../src/shared/authoring.js";
import { acquireDatabaseLock } from "./database-lock.js";
import { compactTestpaqSignatures } from "../src/shared/test-cases.js";

type DatabaseInstance = InstanceType<typeof Database>;

export class TestpaqStore {
  readonly database: DatabaseInstance;
  private readonly releaseLock: () => void;

  constructor(private readonly path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.releaseLock = path === ":memory:" ? () => undefined : acquireDatabaseLock(path);
    const existed = path !== ":memory:" && existsSync(path);
    let opened: DatabaseInstance | undefined;
    try {
      opened = new Database(path);
      this.database = opened;
      this.database.pragma("foreign_keys = ON");
      this.database.pragma("journal_mode = WAL");
      const version = this.database.pragma("user_version", { simple: true }) as number;
      if (version > 7) throw new Error("This workspace was created by a newer Testpaq version. Upgrade Testpaq before opening it.");
      if (existed && version > 0 && version < 7) {
        const backup = `${path}.before-v04-${Date.now()}-${randomUUID()}.backup`;
        this.database.prepare("VACUUM INTO ?").run(backup);
        chmodSync(backup, 0o600);
      }
      this.migrate();
      this.database
        .prepare("UPDATE analysis_runs SET status='failed', error_code='interrupted', completed_at=? WHERE status='running'")
        .run(new Date().toISOString());
    } catch (error) {
      if (opened?.open) opened.close();
      this.releaseLock();
      throw error;
    }
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
    if (version < 3) {
      this.database.exec(`
        CREATE TABLE project_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE);
        PRAGMA user_version = 3;
      `);
    }
    if (version < 4) {
      // Rebuild the status constraint without cascading deletion of analysis history.
      this.database.pragma("foreign_keys = OFF");
      try {
        this.database.transaction(() => {
          this.database.exec(`
            CREATE TABLE testpaqs_v3 (
              id TEXT PRIMARY KEY, title TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL CHECK(status IN ('draft', 'in_review', 'exported', 'completed')),
              payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            INSERT INTO testpaqs_v3 SELECT * FROM testpaqs;
            DROP TABLE testpaqs;
            ALTER TABLE testpaqs_v3 RENAME TO testpaqs;
            CREATE INDEX testpaqs_updated_at_idx ON testpaqs(updated_at DESC);
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            PRAGMA user_version = 4;
          `);
        })();
      } finally {
        this.database.pragma("foreign_keys = ON");
      }
    }
    if (version < 7) {
      this.database.transaction(() => {
        const rows = this.database.prepare("SELECT payload FROM testpaqs").all() as Array<{ payload: string }>;
        for (const row of rows) {
          const item = JSON.parse(row.payload) as Testpaq;
          let changed = false;
          for (const value of item.testCases ?? [])
            if (value.review === "accepted" && caseContentIssues(value).length) {
              value.review = "proposed";
              changed = true;
            }
          for (const value of item.scenarios)
            if (value.review === "accepted" && scenarioContentIssues(value).length) {
              value.review = "proposed";
              changed = true;
            }
          for (const value of item.requirements)
            if (value.active && isDraftText(value.text, "New requirement")) {
              value.active = false;
              changed = true;
            }
          for (const value of item.questions)
            if (value.status === "resolved" && (isDraftText(value.text, "New QA question") || !value.resolution?.trim())) {
              value.status = "open";
              delete value.resolvedAt;
              changed = true;
            }
          if (changed) {
            item.reviewNotice =
              "Some older starter-text approvals were returned to drafts. All content was retained; finish and review those items before handoff.";
            item.updatedAt = new Date(Math.max(Date.now(), Date.parse(item.updatedAt) + 1)).toISOString();
            this.save(item);
          }
        }
        this.database.pragma("user_version = 7");
      })();
    }
  }

  backup(): WorkspaceBackup {
    const rows = this.database.prepare("SELECT payload FROM testpaqs ORDER BY id").all() as Array<{ payload: string }>;
    const runs = this.database.prepare("SELECT * FROM analysis_runs ORDER BY created_at, id").all() as Record<string, string | null>[];
    return WorkspaceBackupSchema.parse({
      format: "testpaq-workspace",
      version: 1,
      createdAt: new Date().toISOString(),
      groups: this.listGroups(),
      testpaqs: rows.map(({ payload }) => JSON.parse(payload)),
      runs: runs.map(mapRun),
      model: this.getSetting("openai_model"),
    });
  }

  restore(input: unknown) {
    const backup = WorkspaceBackupSchema.parse(input);
    if (this.path !== ":memory:") {
      const snapshot = `${this.path}.before-restore-${Date.now()}-${randomUUID()}.backup`;
      this.database.prepare("VACUUM INTO ?").run(snapshot);
      chmodSync(snapshot, 0o600);
    }
    const oldVersions = new Map(this.list().map((value) => [value.id, value.updatedAt]));
    this.database.transaction(() => {
      this.database.exec("DELETE FROM analysis_runs; DELETE FROM testpaqs; DELETE FROM project_groups; DELETE FROM settings;");
      for (const group of backup.groups) this.saveGroup(group.name, group.id);
      for (const item of backup.testpaqs)
        this.save({
          ...item,
          updatedAt: new Date(
            Math.max(Date.now(), Date.parse(item.updatedAt) + 1, Date.parse(oldVersions.get(item.id) ?? item.updatedAt) + 1),
          ).toISOString(),
        });
      this.setSetting("workspace_generation", randomUUID());
      const insert = this.database.prepare(
        `INSERT INTO analysis_runs (id,testpaq_id,provider,model,prompt_version,status,disclosure,input_hash,input_snapshot_json,result_json,error_code,created_at,completed_at) VALUES (@id,@testpaqId,@provider,@model,@promptVersion,@status,@disclosure,@inputHash,@inputSnapshot,@result,@errorCode,@createdAt,@completedAt)`,
      );
      for (const run of backup.runs)
        insert.run({
          ...run,
          status: run.status === "running" ? "failed" : run.status,
          inputSnapshot: run.inputSnapshot ? JSON.stringify(run.inputSnapshot) : null,
          result: run.result ? JSON.stringify(run.result) : null,
          errorCode: run.status === "running" ? "interrupted" : (run.errorCode ?? null),
          completedAt: run.status === "running" ? new Date().toISOString() : (run.completedAt ?? null),
        });
      if (backup.model) this.setSetting("openai_model", backup.model);
    })();
  }

  getSetting(key: string): string | undefined {
    return (this.database.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined)?.value;
  }

  setSetting(key: string, value: string) {
    this.database
      .prepare("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(key, value);
  }

  listGroups(): Array<{ id: string; name: string }> {
    return this.database.prepare("SELECT id, name FROM project_groups ORDER BY name COLLATE NOCASE").all() as Array<{
      id: string;
      name: string;
    }>;
  }

  saveGroup(name: string, id: string = randomUUID()) {
    this.database
      .prepare("INSERT INTO project_groups(id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name")
      .run(id, name);
    return { id, name };
  }

  removeGroup(id: string) {
    return this.database.transaction(() => {
      if (!this.listGroups().some((group) => group.id === id)) return false;
      for (const summary of this.list().filter((item) => item.groupId === id)) {
        const item = this.get(summary.id)!;
        delete item.groupId;
        item.updatedAt = new Date(Math.max(Date.now(), Date.parse(item.updatedAt) + 1)).toISOString();
        this.save(item);
      }
      this.database.prepare("DELETE FROM project_groups WHERE id=?").run(id);
      return true;
    })();
  }

  list(limit = -1, offset = 0, query = "", group = "all", archive = "all"): TestpaqSummary[] {
    const search = `%${query.toLowerCase().replace(/[\\%_]/g, (value) => `\\${value}`)}%`;
    const rows = this.database
      .prepare(
        `SELECT id,title,reference,status,created_at AS createdAt,updated_at AS updatedAt,
      json_extract(payload,'$.groupId') AS groupId, json_extract(payload,'$.archived') AS archived, json_array_length(payload,'$.scenarios') AS scenarioCount,
      (SELECT count(*) FROM json_each(payload,'$.questions') WHERE json_extract(value,'$.status')='open') AS openQuestionCount
      FROM testpaqs WHERE lower(title || ' ' || reference) LIKE ? ESCAPE '\\'
      AND (?='all' OR (?='ungrouped' AND json_extract(payload,'$.groupId') IS NULL) OR json_extract(payload,'$.groupId')=?)
      AND (?='all' OR coalesce(json_extract(payload,'$.archived'),0)=?)
      ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`,
      )
      .all(search, group, group, group, archive, archive === "archived" ? 1 : 0, limit, offset) as TestpaqSummary[];
    return rows.map((row) => ({ ...row, archived: Boolean(row.archived), groupId: row.groupId ?? undefined }));
  }

  get(id: string): Testpaq | undefined {
    const row = this.database.prepare("SELECT payload FROM testpaqs WHERE id = ?").get(id) as { payload: string } | undefined;
    return row ? compactTestpaqSignatures(TestpaqSchema.parse(JSON.parse(row.payload))) : undefined;
  }

  save(input: Testpaq): Testpaq {
    const item = compactTestpaqSignatures(TestpaqSchema.parse(input));
    if (item.groupId && !this.listGroups().some((group) => group.id === item.groupId)) throw new Error("Unknown project group.");
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
    const parsed = AnalysisRunResultSchema.parse(result);
    const completedAt = new Date().toISOString();
    this.database
      .prepare("UPDATE analysis_runs SET status='succeeded', error_code=NULL, result_json=?, completed_at=? WHERE id=?")
      .run(JSON.stringify(parsed), completedAt, id);
    return this.getRun(id)!;
  }

  failRun(id: string, errorCode: string, result?: unknown): AnalysisRun {
    const completedAt = new Date().toISOString();
    this.database
      .prepare("UPDATE analysis_runs SET status='failed', error_code=?, completed_at=?, result_json=COALESCE(?,result_json) WHERE id=?")
      .run(errorCode, completedAt, result === undefined ? null : JSON.stringify(AnalysisRunResultSchema.parse(result)), id);
    return this.getRun(id)!;
  }

  getRuns(testpaqId: string, limit = -1, offset = 0): AnalysisRun[] {
    const rows = this.database
      .prepare("SELECT * FROM analysis_runs WHERE testpaq_id = ? ORDER BY created_at DESC, id LIMIT ? OFFSET ?")
      .all(testpaqId, limit, offset) as Record<string, string | null>[];
    return rows.map(mapRun);
  }

  private getRun(id: string): AnalysisRun | undefined {
    const row = this.database.prepare("SELECT * FROM analysis_runs WHERE id = ?").get(id) as Record<string, string | null> | undefined;
    return row ? mapRun(row) : undefined;
  }

  close() {
    if (this.database.open) this.database.close();
    this.releaseLock();
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
    inputSnapshot: row.input_snapshot_json ? HistoricalAnalysisInputSchema.parse(JSON.parse(row.input_snapshot_json)) : undefined,
    result: row.result_json ? AnalysisRunResultSchema.parse(JSON.parse(row.result_json)) : undefined,
    errorCode: row.error_code ?? undefined,
    createdAt: row.created_at!,
    completedAt: row.completed_at ?? undefined,
  };
}
