import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { invoke } from "../api";
import { DataGrid } from "../components/DataGrid";
import { Chip } from "../components/Chip";
import type { MailboxRow } from "@shared/types";

function gb(bytes: number | null): string {
  return bytes === null ? "—" : `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

const mailboxColumns: ColumnDef<MailboxRow, any>[] = [
  { accessorKey: "tenantName", header: "Tenant" },
  { accessorKey: "userPrincipalName", header: "Mailbox" },
  { accessorKey: "mailboxType", header: "Type" },
  { accessorKey: "sizeBytes", header: "Size", cell: ({ getValue }) => gb(getValue()) },
  {
    accessorKey: "quotaBytes",
    header: "Quota %",
    cell: ({ row }) => {
      const { sizeBytes, quotaBytes } = row.original;
      if (sizeBytes === null || quotaBytes === null || quotaBytes === 0) return "—";
      const pct = Math.round((sizeBytes / quotaBytes) * 100);
      return <Chip tone={pct > 90 ? "fail" : pct > 75 ? "warn" : "pass"}>{pct}%</Chip>;
    },
  },
  {
    accessorKey: "forwardingSmtpAddress",
    header: "Forwarding",
    cell: ({ row }) =>
      row.original.forwardingSmtpAddress ? (
        <Chip tone={row.original.externalForwarding ? "fail" : "warn"}>
          {row.original.forwardingSmtpAddress}
        </Chip>
      ) : (
        "—"
      ),
  },
];

export default function Exchange(): ReactNode {
  const [tab, setTab] = useState<"mailboxes" | "forwarding">("mailboxes");
  const { data } = useQuery({
    queryKey: ["mailboxes"],
    queryFn: () => invoke("data:mailboxes", {}),
  });

  const rows = (data ?? []).filter((m) => tab === "mailboxes" || m.externalForwarding);

  return (
    <div>
      <h1>Exchange Online Auditing</h1>
      <p className="subtitle">
        Mailbox inventory and forwarding audit. Deep EXO data (transport rules, permissions) flows in
        via the bundled PowerShell engine on Exchange-enabled syncs.
      </p>
      <div className="toolbar">
        <button className={`btn${tab === "mailboxes" ? " primary" : ""}`} onClick={() => setTab("mailboxes")}>
          Mailboxes
        </button>
        <button
          className={`btn${tab === "forwarding" ? " primary" : ""}`}
          onClick={() => setTab("forwarding")}
        >
          Forwarding audit
        </button>
      </div>
      <DataGrid
        data={rows}
        columns={mailboxColumns}
        exportName={tab === "mailboxes" ? "mailboxes" : "forwarding-audit"}
        emptyMessage="No mailbox data cached — Exchange sync requires the EXO PowerShell engine."
      />
    </div>
  );
}
