import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "../api";
import { Chip, outcomeTone } from "../components/Chip";
import { DataGrid } from "../components/DataGrid";
import type { AuditFinding } from "@shared/types";
import type { ColumnDef } from "@tanstack/react-table";

const findingColumns: ColumnDef<AuditFinding, any>[] = [
  { accessorKey: "tenantName", header: "Tenant" },
  { accessorKey: "checkTitle", header: "Check" },
  { accessorKey: "category", header: "Category" },
  {
    accessorKey: "severity",
    header: "Severity",
    cell: ({ getValue }) => (
      <Chip tone={getValue() === "critical" || getValue() === "high" ? "fail" : "warn"}>
        {getValue()}
      </Chip>
    ),
  },
  {
    accessorKey: "outcome",
    header: "Outcome",
    cell: ({ getValue }) => <Chip tone={outcomeTone(getValue())}>{String(getValue()).replace("_", " ")}</Chip>,
  },
  { accessorKey: "detail", header: "Detail" },
];

export default function Audit(): ReactNode {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<AuditFinding | null>(null);
  const [showPasses, setShowPasses] = useState(false);

  const { data: checks } = useQuery({
    queryKey: ["checks"],
    queryFn: () => invoke("audit:checks", undefined),
  });
  const { data: findings } = useQuery({
    queryKey: ["findings"],
    queryFn: () => invoke("audit:findings", {}),
  });
  const { data: scores } = useQuery({
    queryKey: ["scores"],
    queryFn: () => invoke("audit:scores", undefined),
  });

  const runAudit = useMutation({
    mutationFn: () => invoke("audit:run", { tenantIds: null }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["findings"] });
      void queryClient.invalidateQueries({ queryKey: ["scores"] });
    },
  });

  const toggleCheck = useMutation({
    mutationFn: ({ checkId, enabled }: { checkId: string; enabled: boolean }) =>
      invoke("audit:setCheckEnabled", { checkId, enabled }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["checks"] }),
  });

  const visibleFindings = (findings ?? []).filter(
    (f) => showPasses || f.outcome === "fail" || f.outcome === "warn",
  );

  return (
    <div>
      <h1>Audit & Baseline Compliance</h1>
      <p className="subtitle">
        Every tenant evaluated against the Affinity IT baseline on every run — scored, trended and
        evidence-backed.
      </p>

      <div className="toolbar">
        <button className="btn primary" onClick={() => runAudit.mutate()} disabled={runAudit.isPending}>
          {runAudit.isPending ? "Evaluating…" : "Run audit now"}
        </button>
        <label>
          <input type="checkbox" checked={showPasses} onChange={(e) => setShowPasses(e.target.checked)} />{" "}
          Show passes
        </label>
      </div>

      <h2>League table</h2>
      <div className="grid-wrap" style={{ marginBottom: 18 }}>
        <table className="grid">
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Score</th>
              <th>Movement</th>
              <th>Pass</th>
              <th>Warn</th>
              <th>Fail</th>
              <th>N/A</th>
              <th>Last run</th>
            </tr>
          </thead>
          <tbody>
            {(scores ?? []).map((t) => (
              <tr key={t.tenantId}>
                <td>{t.tenantName}</td>
                <td>
                  <Chip tone={t.score >= 80 ? "pass" : t.score >= 60 ? "warn" : "fail"}>{t.score}%</Chip>
                </td>
                <td>
                  {t.previousScore === null
                    ? "—"
                    : `${t.score - t.previousScore >= 0 ? "+" : ""}${t.score - t.previousScore}`}
                </td>
                <td>{t.passCount}</td>
                <td>{t.warnCount}</td>
                <td>{t.failCount}</td>
                <td>{t.notAssessableCount}</td>
                <td>{new Date(t.lastRunAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(scores ?? []).length === 0 && <div className="empty">No audit runs yet.</div>}
      </div>

      <h2>Findings</h2>
      <div onClick={(e) => {
        const rowEl = (e.target as HTMLElement).closest("tr");
        if (!rowEl?.parentElement?.matches("tbody")) return;
        const idx = [...rowEl.parentElement.children].indexOf(rowEl);
        setSelected(visibleFindings[idx] ?? null);
      }}>
        <DataGrid data={visibleFindings} columns={findingColumns} exportName="audit-findings" />
      </div>

      {selected && (
        <div className="drawer">
          <button className="btn" style={{ float: "right" }} onClick={() => setSelected(null)}>
            Close
          </button>
          <h2>{selected.checkTitle}</h2>
          <p>
            <Chip tone={outcomeTone(selected.outcome)}>{selected.outcome}</Chip>{" "}
            <Chip tone="neutral">{selected.severity}</Chip> {selected.tenantName}
          </p>
          <p>{selected.detail}</p>
          <h2>Remediation</h2>
          <p>{selected.remediation}</p>
          <h2>Evidence ({selected.evidence.length})</h2>
          <pre className="ps">{JSON.stringify(selected.evidence, null, 2)}</pre>
        </div>
      )}

      <h2>Check library</h2>
      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Enabled</th>
              <th>Check</th>
              <th>Category</th>
              <th>Severity</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {(checks ?? []).map((c) => (
              <tr key={c.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={c.enabled}
                    onChange={(e) => toggleCheck.mutate({ checkId: c.id, enabled: e.target.checked })}
                  />
                </td>
                <td>
                  {c.title} {!c.builtin && <Chip tone="accent">custom</Chip>}
                </td>
                <td>{c.category}</td>
                <td>{c.severity}</td>
                <td className="muted">{c.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
