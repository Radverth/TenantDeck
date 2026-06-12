import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "../api";
import { Chip, outcomeTone } from "../components/Chip";
import type {
  CommitResult,
  DiscoveredTenant,
  SyncSchedule,
  TenantEdit,
  TenantModule,
} from "@shared/types";
import { ALL_MODULES } from "@shared/types";

interface StagedRow {
  tenant: DiscoveredTenant;
  edit: TenantEdit;
  selected: boolean;
}

/**
 * Discover → stage → edit (single or bulk) → validate → commit.
 * Discovery is idempotent: new/linked/orphaned status per row.
 */
export default function TenantRegistry(): ReactNode {
  const queryClient = useQueryClient();
  const [staged, setStaged] = useState<StagedRow[] | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [bulkSchedule, setBulkSchedule] = useState<SyncSchedule>("daily");

  const { data: registry } = useQuery({
    queryKey: ["registry"],
    queryFn: () => invoke("registry:list", undefined),
  });

  const discover = useMutation({
    mutationFn: () => invoke("registry:discover", undefined),
    onSuccess: (tenants) => {
      setCommitResult(null);
      setStaged(
        tenants.map((tenant) => ({
          tenant,
          edit: {},
          selected: tenant.status === "new",
        })),
      );
    },
  });

  const commit = useMutation({
    mutationFn: (rows: StagedRow[]) =>
      invoke("registry:commit", {
        tenants: rows.map((r) => ({ tenant: r.tenant, edit: r.edit })),
      }),
    onSuccess: (result) => {
      setCommitResult(result);
      setStaged(null);
      void queryClient.invalidateQueries({ queryKey: ["registry"] });
    },
  });

  const syncNow = useMutation({
    mutationFn: (tenantIds: string[] | null) => invoke("sync:run", { tenantIds }),
  });

  const setRow = (idx: number, patch: Partial<StagedRow>): void => {
    setStaged((rows) => rows!.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const applyBulk = (edit: TenantEdit): void => {
    setStaged((rows) =>
      rows!.map((r) => (r.selected ? { ...r, edit: { ...r.edit, ...edit } } : r)),
    );
  };

  const selectedRows = staged?.filter((r) => r.selected) ?? [];

  return (
    <div>
      <h1>Tenant Registry</h1>
      <p className="subtitle">
        Enumerates every GDAP relationship (read-only — TenantDeck never creates or modifies GDAP)
        and onboards tenants in one reviewed batch.
      </p>

      <div className="toolbar">
        <button className="btn primary" onClick={() => discover.mutate()} disabled={discover.isPending}>
          {discover.isPending ? "Discovering…" : "Discover GDAP tenants"}
        </button>
        <button className="btn" onClick={() => syncNow.mutate(null)}>
          Sync all now
        </button>
      </div>

      {discover.isError && <p className="chip fail">{String(discover.error)}</p>}

      {commitResult && (
        <p>
          <Chip tone="pass">Committed</Chip> {commitResult.created} created, {commitResult.updated}{" "}
          updated, {commitResult.skipped} skipped, {commitResult.failed.length} failed
          {commitResult.failed.map((f) => (
            <span key={f.tenantId} className="chip fail">
              {f.tenantId}: {f.reason}
            </span>
          ))}
        </p>
      )}

      {staged && (
        <>
          <h2>Staging grid — {selectedRows.length} of {staged.length} selected</h2>
          <div className="toolbar">
            <label>
              Bulk schedule:{" "}
              <select value={bulkSchedule} onChange={(e) => setBulkSchedule(e.target.value as SyncSchedule)}>
                <option value="manual">Manual</option>
                <option value="6h">6-hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>
            <button className="btn" onClick={() => applyBulk({ syncSchedule: bulkSchedule })}>
              Apply to selection
            </button>
            <button
              className="btn"
              onClick={() => setStaged((rows) => rows!.map((r) => ({ ...r, selected: true })))}
            >
              Select all
            </button>
            <div className="spacer" />
            <button
              className="btn accent"
              disabled={selectedRows.length === 0 || commit.isPending}
              onClick={() => commit.mutate(selectedRows)}
            >
              Commit {selectedRows.length} tenant(s)
            </button>
          </div>
          <div className="grid-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th></th>
                  <th>Status</th>
                  <th>Display name</th>
                  <th>Default domain</th>
                  <th>Client code</th>
                  <th>Schedule</th>
                  <th>GDAP roles</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {staged.map((row, idx) => (
                  <tr key={row.tenant.tenantId}>
                    <td>
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={(e) => setRow(idx, { selected: e.target.checked })}
                      />
                    </td>
                    <td>
                      <Chip tone={outcomeTone(row.tenant.status)}>{row.tenant.status}</Chip>
                    </td>
                    <td>
                      <input
                        value={row.edit.displayName ?? row.tenant.displayName}
                        onChange={(e) =>
                          setRow(idx, { edit: { ...row.edit, displayName: e.target.value } })
                        }
                      />
                    </td>
                    <td className="mono">{row.tenant.defaultDomain || "—"}</td>
                    <td>
                      <input
                        placeholder="e.g. Autotask ref"
                        value={row.edit.internalClientCode ?? ""}
                        onChange={(e) =>
                          setRow(idx, { edit: { ...row.edit, internalClientCode: e.target.value } })
                        }
                      />
                    </td>
                    <td>
                      <select
                        value={row.edit.syncSchedule ?? "daily"}
                        onChange={(e) =>
                          setRow(idx, {
                            edit: { ...row.edit, syncSchedule: e.target.value as SyncSchedule },
                          })
                        }
                      >
                        <option value="manual">Manual</option>
                        <option value="6h">6-hourly</option>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                      </select>
                    </td>
                    <td>
                      {row.tenant.gdapRoles.length === 0 ? (
                        <Chip tone="warn">No roles detected</Chip>
                      ) : (
                        row.tenant.gdapRoles.map((r) => (
                          <Chip key={r.roleTemplateId} tone="neutral">
                            {r.roleName}
                          </Chip>
                        ))
                      )}
                    </td>
                    <td>
                      <input
                        value={row.edit.notes ?? ""}
                        onChange={(e) => setRow(idx, { edit: { ...row.edit, notes: e.target.value } })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Registered tenants ({registry?.length ?? 0})</h2>
      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Status</th>
              <th>Name</th>
              <th>Domain</th>
              <th>Client code</th>
              <th>Modules</th>
              <th>Schedule</th>
              <th>Last sync</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(registry ?? []).map((t) => (
              <tr key={t.tenantId}>
                <td>
                  <Chip tone={outcomeTone(t.status)}>{t.status}</Chip>
                  {t.lastSyncError && <Chip tone="fail">sync error</Chip>}
                </td>
                <td>{t.displayName}</td>
                <td className="mono">{t.defaultDomain}</td>
                <td>{t.internalClientCode ?? "—"}</td>
                <td>
                  {(ALL_MODULES as TenantModule[]).map((m) => (
                    <Chip key={m} tone={t.enabledModules.includes(m) ? "accent" : "neutral"}>
                      {m}
                    </Chip>
                  ))}
                </td>
                <td>{t.syncSchedule}</td>
                <td>{t.lastSyncAt ? new Date(t.lastSyncAt).toLocaleString() : "never"}</td>
                <td>
                  <button className="btn" onClick={() => syncNow.mutate([t.tenantId])}>
                    Sync
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(registry ?? []).length === 0 && (
          <div className="empty">No tenants yet — sign in and run discovery.</div>
        )}
      </div>
    </div>
  );
}
