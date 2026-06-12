import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "../api";
import { Chip, outcomeTone } from "../components/Chip";
import type { DryRunDiff, StagedDeploymentRow } from "@shared/types";

/**
 * The guarded write pattern, end to end:
 * stage → validate → dry-run (diff + PowerShell preview) → deploy → rollback.
 */
export default function Connectors(): ReactNode {
  const queryClient = useQueryClient();
  const [templateId, setTemplateId] = useState("");
  const [pickedTenants, setPickedTenants] = useState<Set<string>>(new Set());
  const [staged, setStaged] = useState<StagedDeploymentRow[] | null>(null);
  const [diffs, setDiffs] = useState<DryRunDiff[] | null>(null);
  const [stageDisabled, setStageDisabled] = useState(true);
  const [efTestMode, setEfTestMode] = useState(true);
  const [confirmCount, setConfirmCount] = useState("");

  const { data: templates } = useQuery({
    queryKey: ["templates"],
    queryFn: () => invoke("connectors:templates", undefined),
  });
  const { data: registry } = useQuery({
    queryKey: ["registry"],
    queryFn: () => invoke("registry:list", undefined),
  });
  const { data: inventory } = useQuery({
    queryKey: ["inventory"],
    queryFn: () => invoke("connectors:inventory", undefined),
  });
  const { data: deployments } = useQuery({
    queryKey: ["deployments"],
    queryFn: () => invoke("connectors:deployments", undefined),
  });

  const stage = useMutation({
    mutationFn: () =>
      invoke("connectors:stage", { templateId, tenantIds: [...pickedTenants] }),
    onSuccess: (rows) => {
      setStaged(rows);
      setDiffs(null);
    },
  });

  const dryRun = useMutation({
    mutationFn: () => invoke("connectors:dryRun", { rows: staged! }),
    onSuccess: setDiffs,
  });

  const deploy = useMutation({
    mutationFn: () =>
      invoke("connectors:deploy", {
        rows: staged!,
        templateId,
        stageDisabled,
        efTestMode,
        confirmedTenantCount: confirmCount ? Number(confirmCount) : null,
      }),
    onSuccess: () => {
      setStaged(null);
      setDiffs(null);
      void queryClient.invalidateQueries({ queryKey: ["deployments"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
  });

  const rollback = useMutation({
    mutationFn: ({ deploymentId, tenantId }: { deploymentId: number; tenantId: string }) =>
      invoke("connectors:rollback", { deploymentId, tenantId }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["deployments"] }),
  });

  const tenantCount = new Set((staged ?? []).filter((r) => r.selected).map((r) => r.tenantId)).size;
  const template = templates?.find((t) => t.id === templateId);

  return (
    <div>
      <h1>Exchange Connector Deployment</h1>
      <p className="subtitle">
        Template-driven bulk connector deployment with dry-run diff, PowerShell preview, automatic
        snapshots and one-click rollback. Requires the Exchange Administrator GDAP role.
      </p>

      <h2>1 — Select template and tenants</h2>
      <div className="toolbar">
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">Choose template…</option>
          {(templates ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} (v{t.version})
            </option>
          ))}
        </select>
        <button
          className="btn primary"
          disabled={!templateId || pickedTenants.size === 0 || stage.isPending}
          onClick={() => stage.mutate()}
        >
          Stage {pickedTenants.size} tenant(s)
        </button>
      </div>
      {template && <p className="muted">{template.description}</p>}

      <div className="grid-wrap" style={{ maxHeight: 220, marginBottom: 16 }}>
        <table className="grid">
          <tbody>
            {(registry ?? [])
              .filter((t) => t.status !== "orphaned")
              .map((t) => (
                <tr key={t.tenantId}>
                  <td>
                    <input
                      type="checkbox"
                      checked={pickedTenants.has(t.tenantId)}
                      onChange={(e) => {
                        const next = new Set(pickedTenants);
                        if (e.target.checked) next.add(t.tenantId);
                        else next.delete(t.tenantId);
                        setPickedTenants(next);
                      }}
                    />
                  </td>
                  <td>{t.displayName}</td>
                  <td className="mono">{t.defaultDomain}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {staged && (
        <>
          <h2>2 — Staging grid ({staged.length} rows)</h2>
          <div className="grid-wrap" style={{ marginBottom: 12 }}>
            <table className="grid">
              <thead>
                <tr>
                  <th></th>
                  <th>Tenant</th>
                  <th>Object</th>
                  <th>Name</th>
                  <th>Key fields</th>
                  <th>Validation</th>
                </tr>
              </thead>
              <tbody>
                {staged.map((row, idx) => (
                  <tr key={row.rowId}>
                    <td>
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={(e) =>
                          setStaged((rows) =>
                            rows!.map((r, i) => (i === idx ? { ...r, selected: e.target.checked } : r)),
                          )
                        }
                      />
                    </td>
                    <td>{row.tenantName}</td>
                    <td>
                      <Chip tone="neutral">{row.kind}</Chip>
                    </td>
                    <td>{(row.spec as { name: string }).name}</td>
                    <td className="mono">
                      {"senderIPAddresses" in row.spec && (
                        <input
                          placeholder="Sender IPs (comma-separated)"
                          value={(row.spec.senderIPAddresses as string[]).join(",")}
                          onChange={(e) =>
                            setStaged((rows) =>
                              rows!.map((r, i) =>
                                i === idx
                                  ? {
                                      ...r,
                                      spec: {
                                        ...r.spec,
                                        senderIPAddresses: e.target.value
                                          .split(",")
                                          .map((s) => s.trim())
                                          .filter(Boolean),
                                      },
                                    }
                                  : r,
                              ),
                            )
                          }
                        />
                      )}
                      {"smartHosts" in row.spec && (row.spec.smartHosts as string[]).join(", ")}
                      {"fromIPs" in row.spec && (row.spec.fromIPs as string[]).join(", ")}
                    </td>
                    <td>
                      {row.validation.ok ? (
                        <Chip tone="pass">ok</Chip>
                      ) : (
                        row.validation.errors.map((e, i) => (
                          <Chip key={i} tone="fail">
                            {e}
                          </Chip>
                        ))
                      )}
                      {row.validation.warnings.map((w, i) => (
                        <Chip key={i} tone="warn">
                          {w}
                        </Chip>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="toolbar">
            <button
              className="btn"
              onClick={async () => setStaged(await invoke("connectors:validate", { rows: staged }))}
            >
              Re-validate
            </button>
            <button className="btn primary" onClick={() => dryRun.mutate()} disabled={dryRun.isPending}>
              {dryRun.isPending ? "Running dry run…" : "3 — Dry run"}
            </button>
          </div>
        </>
      )}

      {diffs && (
        <>
          <h2>Dry-run diff & PowerShell preview</h2>
          {diffs.map((d) => (
            <div key={d.rowId} className="card" style={{ marginBottom: 10 }}>
              <p>
                <Chip tone={d.action === "create" ? "warn" : d.action === "noop" ? "neutral" : "accent"}>
                  {d.action}
                </Chip>{" "}
                {staged?.find((r) => r.rowId === d.rowId)?.tenantName}
                {d.fieldChanges.length > 0 && (
                  <span className="muted"> — {d.fieldChanges.length} field change(s)</span>
                )}
              </p>
              <pre className="ps">{d.powershellPreview}</pre>
            </div>
          ))}

          <h2>4 — Deploy</h2>
          <div className="toolbar">
            <label>
              <input
                type="checkbox"
                checked={stageDisabled}
                onChange={(e) => setStageDisabled(e.target.checked)}
              />{" "}
              Stage connectors disabled
            </label>
            <label>
              <input type="checkbox" checked={efTestMode} onChange={(e) => setEfTestMode(e.target.checked)} />{" "}
              Enhanced Filtering test mode
            </label>
            <input
              placeholder={`Type tenant count (${tenantCount}) to confirm large batch`}
              value={confirmCount}
              onChange={(e) => setConfirmCount(e.target.value)}
              style={{ width: 280 }}
            />
            <button className="btn accent" onClick={() => deploy.mutate()} disabled={deploy.isPending}>
              {deploy.isPending ? "Deploying…" : `Deploy to ${tenantCount} tenant(s)`}
            </button>
          </div>
          {deploy.isError && <p className="chip fail">{String(deploy.error)}</p>}
        </>
      )}

      <h2>Deployment history</h2>
      <div className="grid-wrap" style={{ marginBottom: 18 }}>
        <table className="grid">
          <thead>
            <tr>
              <th>ID</th>
              <th>Template</th>
              <th>Started</th>
              <th>By</th>
              <th>Items</th>
              <th>Rollback</th>
            </tr>
          </thead>
          <tbody>
            {(deployments ?? []).map((d) => (
              <tr key={d.id}>
                <td>{d.id}</td>
                <td>
                  {d.templateId} v{d.templateVersion}
                </td>
                <td>{new Date(d.startedAt).toLocaleString()}</td>
                <td>{d.startedBy}</td>
                <td>
                  {d.items.map((i) => (
                    <Chip key={i.rowId} tone={outcomeTone(i.state)}>
                      {i.state}
                    </Chip>
                  ))}
                </td>
                <td>
                  {[...new Set(d.items.filter((i) => i.state === "succeeded").map((i) => i.tenantId))].map(
                    (tid) => (
                      <button
                        key={tid}
                        className="btn danger"
                        onClick={() => rollback.mutate({ deploymentId: d.id, tenantId: tid })}
                      >
                        Roll back {registry?.find((t) => t.tenantId === tid)?.displayName ?? tid}
                      </button>
                    ),
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(deployments ?? []).length === 0 && <div className="empty">No deployments yet.</div>}
      </div>

      <h2>Connector inventory</h2>
      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Direction</th>
              <th>Name</th>
              <th>Enabled</th>
              <th>Type</th>
              <th>Template</th>
              <th>Drift</th>
            </tr>
          </thead>
          <tbody>
            {(inventory ?? []).map((c, i) => (
              <tr key={i}>
                <td>{c.tenantName}</td>
                <td>{c.direction}</td>
                <td>{c.name}</td>
                <td>
                  <Chip tone={c.enabled ? "pass" : "neutral"}>{c.enabled ? "enabled" : "disabled"}</Chip>
                </td>
                <td>{c.connectorType ?? "—"}</td>
                <td>{c.templateId ?? "—"}</td>
                <td>{c.drift ? <Chip tone="fail">drift</Chip> : <Chip tone="pass">aligned</Chip>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(inventory ?? []).length === 0 && (
          <div className="empty">No connector inventory cached — deploy or sync to populate.</div>
        )}
      </div>
    </div>
  );
}
