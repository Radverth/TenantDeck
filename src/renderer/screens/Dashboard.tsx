import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "../api";
import { Chip, outcomeTone } from "../components/Chip";

export default function Dashboard(): ReactNode {
  const { data: summary } = useQuery({
    queryKey: ["summary"],
    queryFn: () => invoke("data:summary", undefined),
  });
  const { data: syncStatus } = useQuery({
    queryKey: ["syncStatus"],
    queryFn: () => invoke("sync:status", undefined),
    refetchInterval: 3000,
  });
  const { data: scores } = useQuery({
    queryKey: ["scores"],
    queryFn: () => invoke("audit:scores", undefined),
  });

  const cards: { label: string; value: number | string; alert?: boolean }[] = summary
    ? [
        { label: "Tenants", value: summary.tenantCount },
        { label: "Users", value: summary.userCount },
        { label: "Licensed users", value: summary.licensedUserCount },
        { label: "Unassigned licenses", value: summary.unassignedLicenses, alert: summary.unassignedLicenses > 0 },
        { label: "Admins without MFA", value: summary.adminsWithoutMfa, alert: summary.adminsWithoutMfa > 0 },
        { label: "External forwarding", value: summary.externalForwardingMailboxes, alert: summary.externalForwardingMailboxes > 0 },
        { label: "Domains missing DMARC", value: summary.domainsMissingDmarc, alert: summary.domainsMissingDmarc > 0 },
        { label: "Sync errors", value: summary.tenantsWithSyncErrors, alert: summary.tenantsWithSyncErrors > 0 },
      ]
    : [];

  const running = syncStatus?.filter((s) => s.state === "running" || s.state === "queued") ?? [];
  const worstTenants = (scores ?? []).slice(0, 5);

  return (
    <div>
      <h1>Dashboard</h1>
      <p className="subtitle">Estate summary across every connected tenant.</p>

      <div className="cards">
        {cards.map((c) => (
          <div key={c.label} className={`card${c.alert ? " alert" : ""}`}>
            <div className="value">{c.value}</div>
            <div className="label">{c.label}</div>
          </div>
        ))}
      </div>

      {running.length > 0 && (
        <>
          <h2>Sync in progress</h2>
          {running.map((s) => (
            <div key={s.tenantId}>
              <Chip tone={outcomeTone(s.state)}>{s.state}</Chip> {s.tenantId}
            </div>
          ))}
        </>
      )}

      <h2>Tenants needing attention</h2>
      {worstTenants.length === 0 ? (
        <p className="muted">Run an audit to populate the league table.</p>
      ) : (
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Score</th>
                <th>Movement</th>
                <th>Fail</th>
                <th>Warn</th>
              </tr>
            </thead>
            <tbody>
              {worstTenants.map((t) => (
                <tr key={t.tenantId}>
                  <td>{t.tenantName}</td>
                  <td>
                    <Chip tone={t.score >= 80 ? "pass" : t.score >= 60 ? "warn" : "fail"}>
                      {t.score}%
                    </Chip>
                  </td>
                  <td>
                    {t.previousScore === null
                      ? "—"
                      : `${t.score - t.previousScore >= 0 ? "+" : ""}${t.score - t.previousScore}`}
                  </td>
                  <td>{t.failCount}</td>
                  <td>{t.warnCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
