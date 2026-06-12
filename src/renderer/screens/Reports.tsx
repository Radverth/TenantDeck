import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke, exportCsv } from "../api";

/**
 * v1 ships CSV exports per grid (every DataGrid has its own export button)
 * plus the estate snapshot below. Branded PDF health reports render via
 * headless Chromium print-to-PDF in Phase 7.
 */
export default function Reports(): ReactNode {
  const { data: scores } = useQuery({
    queryKey: ["scores"],
    queryFn: () => invoke("audit:scores", undefined),
  });

  const exportLeagueTable = async (): Promise<void> => {
    await exportCsv(
      "tenant-league-table.csv",
      ["Tenant", "Score", "Previous", "Pass", "Warn", "Fail", "Not assessable", "Last run"],
      (scores ?? []).map((t) => [
        t.tenantName,
        t.score,
        t.previousScore,
        t.passCount,
        t.warnCount,
        t.failCount,
        t.notAssessableCount,
        t.lastRunAt,
      ]),
    );
  };

  return (
    <div>
      <h1>Reporting & Export</h1>
      <p className="subtitle">
        Client-ready evidence from the audit engine. Branded PDF report builder lands in Phase 7 —
        CSV export is available from every grid in the app today.
      </p>
      <div className="toolbar">
        <button className="btn primary" onClick={exportLeagueTable}>
          Export compliance league table (CSV)
        </button>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Coming in Phase 7</h2>
        <ul className="muted">
          <li>Branded per-client PDF health reports (navy/amber Affinity IT template)</li>
          <li>Report builder: pick tenant(s), pick sections, preview, export</li>
          <li>XLSX export alongside CSV</li>
          <li>Export history</li>
        </ul>
      </div>
    </div>
  );
}
