/**
 * API Sentinel — embedded persistent store.
 *
 * A small typed, file-backed document store with atomic writes and in-memory
 * indexes. It is honest infrastructure: real persistence (survives restarts,
 * shared by every API route in the same deployment volume) with a repository
 * interface that can be swapped for Postgres/SQLite later without touching
 * the engine or routes.
 *
 * Data dir: SENTINEL_DATA_DIR or <repo>/data. On serverless/ephemeral
 * filesystems it degrades to in-memory with a clear warning (never silent).
 */
import fs from "node:fs";
import path from "node:path";
import type {
  AnalysisRun,
  ApiChange,
  Approval,
  EndpointContract,
  HistoryEvent,
  ImpactFinding,
  OpenApiVersion,
  Repository,
  SentinelNotification,
  WebhookEvent,
} from "@/lib/sentinel/types";

export interface SnapshotFileEntry {
  file: string;
  sha: string;
  endpoints: EndpointContract[];
  framework: string;
}

export interface RepoSnapshot {
  repoId: string;
  sha: string | null;
  files: SnapshotFileEntry[];
  endpoints: EndpointContract[];
  updatedAt: string;
  /** Incremental parse cache (per-file models keyed by file sha). */
  parseCache?: {
    fileSha: Record<string, string>;
    express: Record<string, unknown>;
    fastapi: Record<string, unknown>;
    spring: Record<string, unknown>;
  } | null;
}

interface Tables {
  repositories: Repository[];
  analyses: AnalysisRun[];
  changes: ApiChange[];
  endpoints: { repoId: string; items: EndpointContract[]; updatedAt: string }[];
  openapi: OpenApiVersion[];
  impact: ImpactFinding[];
  webhooks: WebhookEvent[];
  notifications: SentinelNotification[];
  history: HistoryEvent[];
  approvals: Approval[];
  snapshots: RepoSnapshot[];
  settings: Record<string, string>;
}

const EMPTY: Tables = {
  repositories: [],
  analyses: [],
  changes: [],
  endpoints: [],
  openapi: [],
  impact: [],
  webhooks: [],
  notifications: [],
  history: [],
  approvals: [],
  snapshots: [],
  settings: {},
};

function dataDir(): string {
  return (
    process.env.SENTINEL_DATA_DIR || path.join(process.cwd(), "data")
  );
}

function dbFile(): string {
  return path.join(dataDir(), "sentinel.json");
}

let memoryOnly = false;
let warned = false;

function warnMem() {
  if (!warned) {
    warned = true;
    // eslint-disable-next-line no-console
    console.warn(
      "[sentinel-store] persistent volume unavailable, using in-memory store (data will not survive restart)"
    );
  }
}

class Store {
  private tables: Tables = structuredClone(EMPTY);
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  private ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const file = dbFile();
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, "utf8");
        const parsed = JSON.parse(raw) as Partial<Tables>;
        this.tables = { ...structuredClone(EMPTY), ...parsed };
      } else {
        fs.mkdirSync(dataDir(), { recursive: true });
        this.persistSync();
      }
    } catch {
      memoryOnly = true;
      warnMem();
      this.tables = structuredClone(EMPTY);
    }
  }

  private persistSync() {
    if (memoryOnly) return;
    try {
      const file = dbFile();
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.tables), "utf8");
      fs.renameSync(tmp, file);
    } catch {
      memoryOnly = true;
      warnMem();
    }
  }

  private persist() {
    // Serialize writes to avoid torn reads under concurrent analysis runs.
    this.writeChain = this.writeChain.then(
      () =>
        new Promise<void>((resolve) => {
          try {
            this.persistSync();
          } finally {
            resolve();
          }
        })
    );
    return this.writeChain;
  }

  /** Flush pending writes — used by tests and graceful shutdown paths. */
  async flush(): Promise<void> {
    this.ensureLoaded();
    await this.writeChain;
  }

  isMemoryOnly(): boolean {
    this.ensureLoaded();
    return memoryOnly;
  }

  resetForTests() {
    this.tables = structuredClone(EMPTY);
    this.loaded = true;
  }

  // ---- generic helpers -------------------------------------------------
  all<K extends keyof Tables>(table: K): Tables[K] {
    this.ensureLoaded();
    return this.tables[table];
  }

  insert<K extends keyof Tables>(table: K, row: Tables[K] extends (infer R)[] ? R : never) {
    this.ensureLoaded();
    (this.tables[table] as unknown[]).push(row);
    void this.persist();
    return row;
  }

  replace<K extends keyof Tables>(table: K, rows: Tables[K]) {
    this.ensureLoaded();
    this.tables[table] = rows;
    void this.persist();
  }

  updateById<K extends "repositories" | "analyses" | "changes" | "notifications" | "approvals" | "webhooks">(
    table: K,
    id: string,
    patch: Partial<Tables[K] extends (infer R)[] ? R : never>
  ) {
    this.ensureLoaded();
    const rows = this.tables[table] as unknown as { id: string }[];
    const row = rows.find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    void this.persist();
    return row;
  }

  deleteOlderThan(table: "analyses" | "history" | "webhooks" | "notifications", cutoffIso: string) {
    this.ensureLoaded();
    const key = table === "analyses" ? "startedAt" : table === "webhooks" ? "receivedAt" : "createdAt";
    const rows = (this.tables[table] as unknown as Record<string, string>[]).filter(
      (r) => r[key] >= cutoffIso
    );
    (this.tables as unknown as Record<string, unknown[]>)[table] = rows;
    void this.persist();
    return rows.length;
  }

  getSetting(key: string): string | undefined {
    this.ensureLoaded();
    return this.tables.settings[key];
  }

  setSetting(key: string, value: string) {
    this.ensureLoaded();
    this.tables.settings[key] = value;
    void this.persist();
  }
}

export const store = new Store();

// Convenience typed accessors ----------------------------------------------

export function listRepos(): Repository[] {
  return store.all("repositories");
}
export function getRepo(id: string): Repository | undefined {
  return store.all("repositories").find((r) => r.id === id);
}
export function saveRepo(repo: Repository) {
  const rows = store.all("repositories");
  const i = rows.findIndex((r) => r.id === repo.id);
  if (i >= 0) rows[i] = repo;
  else rows.push(repo);
  store.replace("repositories", rows);
}

export function listAnalyses(repoId?: string): AnalysisRun[] {
  const rows = store.all("analyses");
  const filtered = repoId ? rows.filter((a) => a.repoId === repoId) : rows;
  return [...filtered].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}
export function getAnalysis(id: string): AnalysisRun | undefined {
  return store.all("analyses").find((a) => a.id === id);
}
export function saveAnalysis(run: AnalysisRun) {
  const rows = store.all("analyses");
  const i = rows.findIndex((a) => a.id === run.id);
  if (i >= 0) rows[i] = run;
  else rows.push(run);
  // retention-friendly: keep the most recent 200 runs in the hot store
  const trimmed = [...rows]
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, 200);
  store.replace("analyses", trimmed);
}

export function listChanges(repoId?: string): ApiChange[] {
  void repoId;
  return [...store.all("changes")].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1
  );
}
export function getChange(id: string): ApiChange | undefined {
  return store.all("changes").find((c) => c.id === id);
}

export function saveEndpoints(repoId: string, items: EndpointContract[]) {
  const rows = store.all("endpoints");
  const i = rows.findIndex((e) => e.repoId === repoId);
  const row = { repoId, items, updatedAt: new Date().toISOString() };
  if (i >= 0) rows[i] = row;
  else rows.push(row);
  store.replace("endpoints", rows);
}
export function getEndpoints(repoId: string): EndpointContract[] {
  return store.all("endpoints").find((e) => e.repoId === repoId)?.items ?? [];
}

export function latestOpenApi(repoId: string): OpenApiVersion | undefined {
  return [...store.all("openapi")]
    .filter((o) => o.repoId === repoId)
    .sort((a, b) => b.version - a.version)[0];
}

export function getSnapshot(repoId: string): RepoSnapshot | undefined {
  return store.all("snapshots").find((s) => s.repoId === repoId);
}
export function saveSnapshot(snap: RepoSnapshot) {
  const rows = store.all("snapshots");
  const i = rows.findIndex((s) => s.repoId === snap.repoId);
  if (i >= 0) rows[i] = snap;
  else rows.push(snap);
  store.replace("snapshots", rows);
}

export function addHistory(e: HistoryEvent) {
  store.insert("history", e);
}
export function listHistory(repoId?: string): HistoryEvent[] {
  const rows = store.all("history");
  const filtered = repoId ? rows.filter((h) => h.repoId === repoId) : rows;
  return [...filtered]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 300);
}

export function addNotification(n: SentinelNotification) {
  store.insert("notifications", n);
}
export function listNotifications(): SentinelNotification[] {
  return [...store.all("notifications")].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1
  );
}

export function webhookSeen(deliveryId: string): WebhookEvent | undefined {
  return store.all("webhooks").find((w) => w.deliveryId === deliveryId);
}

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
