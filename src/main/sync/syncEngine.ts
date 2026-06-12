import { GraphClient } from "../graph/graphClient";
import { getDb } from "../db/database";
import { listTenants, setSyncResult } from "../db/tenantRepo";
import { getSettings } from "../db/settingsRepo";
import {
  collectDomains,
  collectGroups,
  collectLicenses,
  collectUsers,
  type Collector,
} from "./collectors";
import type { SyncProgressEvent, TenantModule, TenantSyncStatus } from "@shared/types";

const COLLECTORS: { module: TenantModule; name: string; run: Collector }[] = [
  { module: "identity", name: "users", run: collectUsers },
  { module: "licensing", name: "licenses", run: collectLicenses },
  { module: "groups", name: "groups", run: collectGroups },
  { module: "domains", name: "domains", run: collectDomains },
];

type ProgressListener = (e: SyncProgressEvent) => void;

/**
 * Iterates tenants with a concurrency limit (default 4). Per-tenant failures
 * are isolated: one tenant erroring never fails the batch.
 */
class SyncEngine {
  private statuses = new Map<string, TenantSyncStatus>();
  private listeners = new Set<ProgressListener>();
  private running = false;

  onProgress(l: ProgressListener): void {
    this.listeners.add(l);
  }

  private emit(e: SyncProgressEvent): void {
    for (const l of this.listeners) l(e);
  }

  getStatuses(): TenantSyncStatus[] {
    return [...this.statuses.values()];
  }

  async run(tenantIds: string[] | null): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const all = listTenants().filter((t) => t.status !== "orphaned");
      const targets = tenantIds ? all.filter((t) => tenantIds.includes(t.tenantId)) : all;
      const concurrency = Math.max(1, getSettings().syncConcurrency);

      for (const t of targets) {
        this.statuses.set(t.tenantId, {
          tenantId: t.tenantId,
          state: "queued",
          startedAt: null,
          finishedAt: null,
          error: null,
          entityCounts: {},
        });
      }

      const queue = [...targets];
      const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () =>
        this.worker(queue),
      );
      await Promise.all(workers);
    } finally {
      this.running = false;
    }
  }

  private async worker(
    queue: { tenantId: string; enabledModules: TenantModule[] }[],
  ): Promise<void> {
    for (;;) {
      const tenant = queue.shift();
      if (!tenant) return;
      await this.syncTenant(tenant.tenantId, tenant.enabledModules);
    }
  }

  private async syncTenant(tenantId: string, enabledModules: TenantModule[]): Promise<void> {
    const status = this.statuses.get(tenantId)!;
    status.state = "running";
    status.startedAt = new Date().toISOString();
    this.emit({ tenantId, state: "running", message: "Sync started" });

    const db = getDb();
    const runId = db
      .prepare("INSERT INTO sync_runs (tenant_id, started_at, state) VALUES (?, ?, 'running')")
      .run(tenantId, status.startedAt).lastInsertRowid;

    const graph = new GraphClient(tenantId);
    const errors: string[] = [];

    for (const collector of COLLECTORS) {
      if (!enabledModules.includes(collector.module)) continue;
      try {
        const count = await collector.run(tenantId, graph);
        status.entityCounts[collector.name] = count;
        this.emit({ tenantId, state: "running", message: `${collector.name}: ${count}` });
      } catch (e) {
        errors.push(`${collector.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    status.finishedAt = new Date().toISOString();
    status.error = errors.length > 0 ? errors.join("; ") : null;
    status.state = errors.length > 0 ? "error" : "ok";

    db.prepare(
      "UPDATE sync_runs SET finished_at = ?, state = ?, error = ?, entity_counts = ? WHERE id = ?",
    ).run(status.finishedAt, status.state, status.error, JSON.stringify(status.entityCounts), runId);
    setSyncResult(tenantId, status.error);

    this.emit({
      tenantId,
      state: status.state,
      message: status.error ?? "Sync complete",
    });
  }
}

export const syncEngine = new SyncEngine();
