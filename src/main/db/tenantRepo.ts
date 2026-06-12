import { getDb } from "./database";
import type {
  CommitResult,
  DiscoveredTenant,
  TenantEdit,
  TenantRecord,
  TenantStatus,
} from "@shared/types";
import { ALL_MODULES } from "@shared/types";

interface TenantRowDb {
  tenant_id: string;
  display_name: string;
  default_domain: string;
  internal_client_code: string | null;
  enabled_modules: string;
  sync_schedule: string;
  gdap_roles: string;
  status: string;
  last_sync_at: string | null;
  last_sync_error: string | null;
  notes: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
}

function toRecord(r: TenantRowDb): TenantRecord {
  return {
    tenantId: r.tenant_id,
    displayName: r.display_name,
    defaultDomain: r.default_domain,
    internalClientCode: r.internal_client_code,
    enabledModules: JSON.parse(r.enabled_modules),
    syncSchedule: r.sync_schedule as TenantRecord["syncSchedule"],
    gdapRoles: JSON.parse(r.gdap_roles),
    status: r.status as TenantStatus,
    lastSyncAt: r.last_sync_at,
    lastSyncError: r.last_sync_error,
    notes: r.notes,
    tags: JSON.parse(r.tags),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listTenants(): TenantRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM tenants ORDER BY display_name COLLATE NOCASE")
    .all() as TenantRowDb[];
  return rows.map(toRecord);
}

export function getTenant(tenantId: string): TenantRecord | null {
  const row = getDb().prepare("SELECT * FROM tenants WHERE tenant_id = ?").get(tenantId) as
    | TenantRowDb
    | undefined;
  return row ? toRecord(row) : null;
}

/** Commit staged rows in one transaction; idempotent on tenant_id. */
export function commitTenants(
  staged: { tenant: DiscoveredTenant; edit: TenantEdit }[],
  defaultSchedule: string,
): CommitResult {
  const db = getDb();
  const result: CommitResult = { created: 0, updated: 0, skipped: 0, failed: [] };
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO tenants (tenant_id, display_name, default_domain, internal_client_code,
      enabled_modules, sync_schedule, gdap_roles, status, notes, tags, created_at, updated_at)
    VALUES (@tenant_id, @display_name, @default_domain, @internal_client_code,
      @enabled_modules, @sync_schedule, @gdap_roles, 'linked', @notes, @tags, @now, @now)
    ON CONFLICT(tenant_id) DO UPDATE SET
      display_name = excluded.display_name,
      internal_client_code = excluded.internal_client_code,
      enabled_modules = excluded.enabled_modules,
      sync_schedule = excluded.sync_schedule,
      gdap_roles = excluded.gdap_roles,
      status = 'linked',
      notes = excluded.notes,
      tags = excluded.tags,
      updated_at = excluded.updated_at
  `);
  const exists = db.prepare("SELECT 1 FROM tenants WHERE tenant_id = ?");

  const tx = db.transaction(() => {
    for (const { tenant, edit } of staged) {
      try {
        const already = exists.get(tenant.tenantId) !== undefined;
        insert.run({
          tenant_id: tenant.tenantId,
          display_name: edit.displayName ?? tenant.displayName,
          default_domain: tenant.defaultDomain,
          internal_client_code: edit.internalClientCode ?? null,
          enabled_modules: JSON.stringify(edit.enabledModules ?? ALL_MODULES),
          sync_schedule: edit.syncSchedule ?? defaultSchedule,
          gdap_roles: JSON.stringify(tenant.gdapRoles),
          notes: edit.notes ?? null,
          tags: JSON.stringify(edit.tags ?? []),
          now,
        });
        if (already) result.updated++;
        else result.created++;
      } catch (e) {
        result.failed.push({ tenantId: tenant.tenantId, reason: String(e) });
      }
    }
  });
  tx();
  return result;
}

export function updateTenants(tenantIds: string[], edit: TenantEdit): TenantRecord[] {
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const id of tenantIds) {
      const current = getTenant(id);
      if (!current) continue;
      db.prepare(`
        UPDATE tenants SET display_name = ?, internal_client_code = ?, enabled_modules = ?,
          sync_schedule = ?, notes = ?, tags = ?, updated_at = ?
        WHERE tenant_id = ?
      `).run(
        edit.displayName ?? current.displayName,
        edit.internalClientCode !== undefined ? edit.internalClientCode : current.internalClientCode,
        JSON.stringify(edit.enabledModules ?? current.enabledModules),
        edit.syncSchedule ?? current.syncSchedule,
        edit.notes !== undefined ? edit.notes : current.notes,
        JSON.stringify(edit.tags ?? current.tags),
        now,
        id,
      );
    }
  });
  tx();
  return tenantIds.map((id) => getTenant(id)).filter((t): t is TenantRecord => t !== null);
}

export function removeTenants(tenantIds: string[]): void {
  const db = getDb();
  const tx = db.transaction(() => {
    for (const id of tenantIds) {
      db.prepare("DELETE FROM tenants WHERE tenant_id = ?").run(id);
    }
  });
  tx();
}

/** Mark tenants whose GDAP relationship has disappeared as orphaned. */
export function markOrphans(discoveredIds: Set<string>): void {
  const db = getDb();
  const all = listTenants();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const t of all) {
      const orphaned = !discoveredIds.has(t.tenantId);
      if (orphaned && t.status !== "orphaned") {
        db.prepare("UPDATE tenants SET status = 'orphaned', updated_at = ? WHERE tenant_id = ?").run(now, t.tenantId);
      } else if (!orphaned && t.status === "orphaned") {
        db.prepare("UPDATE tenants SET status = 'linked', updated_at = ? WHERE tenant_id = ?").run(now, t.tenantId);
      }
    }
  });
  tx();
}

export function setSyncResult(tenantId: string, error: string | null): void {
  getDb()
    .prepare("UPDATE tenants SET last_sync_at = ?, last_sync_error = ? WHERE tenant_id = ?")
    .run(new Date().toISOString(), error, tenantId);
}

const TENANT_DATA_TABLES = [
  "users",
  "license_skus",
  "groups",
  "domains",
  "mailboxes",
  "exo_connectors",
  "exo_transport_rules",
  "snapshots",
  "sync_runs",
  "audit_findings",
  "tenant_scores",
];

export function purgeTenantData(tenantIds: string[] | null): void {
  const db = getDb();
  const tx = db.transaction(() => {
    for (const table of TENANT_DATA_TABLES) {
      if (tenantIds === null) {
        db.prepare(`DELETE FROM ${table}`).run();
      } else {
        for (const id of tenantIds) {
          db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(id);
        }
      }
    }
  });
  tx();
}
