import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "../api";
import type { AppSettings } from "@shared/types";

export default function Settings(): ReactNode {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => invoke("settings:get", undefined),
  });
  const [form, setForm] = useState<AppSettings | null>(null);

  useEffect(() => {
    if (settings && !form) setForm(settings);
  }, [settings, form]);

  const save = useMutation({
    mutationFn: (s: AppSettings) => invoke("settings:set", { settings: s }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });

  const purge = useMutation({
    mutationFn: () => invoke("registry:purgeData", { tenantIds: null }),
  });

  if (!form) return <p className="muted">Loading…</p>;

  const field = (label: string, input: ReactNode): ReactNode => (
    <div style={{ marginBottom: 12, maxWidth: 520 }}>
      <div style={{ marginBottom: 4 }}>{label}</div>
      {input}
    </div>
  );

  return (
    <div>
      <h1>Settings</h1>
      <p className="subtitle">Partner connection, sync defaults and hygiene tools.</p>

      <h2>Partner connection</h2>
      {field(
        "Client ID (Microsoft first-party public client — default: Microsoft Graph Command Line Tools)",
        <input
          style={{ width: "100%" }}
          className="mono"
          value={form.clientId}
          onChange={(e) => setForm({ ...form, clientId: e.target.value })}
        />,
      )}
      {field(
        "Partner tenant ID (set automatically on sign-in)",
        <input style={{ width: "100%" }} className="mono" value={form.partnerTenantId ?? ""} readOnly />,
      )}

      <h2>Sync</h2>
      {field(
        "Concurrency (tenants synced in parallel)",
        <input
          type="number"
          min={1}
          max={16}
          value={form.syncConcurrency}
          onChange={(e) => setForm({ ...form, syncConcurrency: Number(e.target.value) })}
        />,
      )}
      {field(
        "Default sync schedule for new tenants",
        <select
          value={form.defaultSyncSchedule}
          onChange={(e) =>
            setForm({ ...form, defaultSyncSchedule: e.target.value as AppSettings["defaultSyncSchedule"] })
          }
        >
          <option value="manual">Manual</option>
          <option value="6h">6-hourly</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>,
      )}

      <h2>Safety</h2>
      {field(
        "Typed confirmation required for deployments above this tenant count",
        <input
          type="number"
          min={1}
          value={form.largeBatchConfirmThreshold}
          onChange={(e) => setForm({ ...form, largeBatchConfirmThreshold: Number(e.target.value) })}
        />,
      )}

      <div className="toolbar">
        <button className="btn primary" onClick={() => save.mutate(form)} disabled={save.isPending}>
          Save settings
        </button>
        {save.isSuccess && <span className="chip pass">Saved</span>}
      </div>

      <h2>Data hygiene</h2>
      <div className="toolbar">
        <button
          className="btn danger"
          onClick={() => {
            if (window.confirm("Purge ALL cached tenant data? The registry is kept; caches re-fill on next sync.")) {
              purge.mutate();
            }
          }}
        >
          Purge all cached data
        </button>
        {purge.isSuccess && <span className="chip pass">Purged</span>}
      </div>
    </div>
  );
}
