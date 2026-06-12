import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { invoke } from "../api";
import { DataGrid } from "../components/DataGrid";
import { Chip } from "../components/Chip";
import type { DnsCheckResult, DomainRow } from "@shared/types";

function dnsCell(result: DnsCheckResult): ReactNode {
  const tone = result.health === "pass" ? "pass" : result.health === "warn" ? "warn" : result.health === "fail" ? "fail" : "neutral";
  return (
    <span title={`${result.detail}${result.record ? `\n${result.record}` : ""}`}>
      <Chip tone={tone}>{result.health}</Chip>
    </span>
  );
}

const columns: ColumnDef<DomainRow, any>[] = [
  { accessorKey: "tenantName", header: "Tenant" },
  { accessorKey: "domain", header: "Domain" },
  {
    accessorKey: "isDefault",
    header: "Default",
    cell: ({ getValue }) => (getValue() ? "Yes" : "—"),
  },
  {
    accessorKey: "isVerified",
    header: "Verified",
    cell: ({ getValue }) => (getValue() ? "Yes" : <Chip tone="warn">no</Chip>),
  },
  { accessorKey: "spf", header: "SPF", cell: ({ getValue }) => dnsCell(getValue()) },
  { accessorKey: "dkim", header: "DKIM", cell: ({ getValue }) => dnsCell(getValue()) },
  { accessorKey: "dmarc", header: "DMARC", cell: ({ getValue }) => dnsCell(getValue()) },
];

export default function Domains(): ReactNode {
  const { data } = useQuery({ queryKey: ["domains"], queryFn: () => invoke("data:domains", {}) });

  return (
    <div>
      <h1>Domains & Mail Health</h1>
      <p className="subtitle">
        Verified domains with live SPF, DKIM and DMARC DNS validation — hover a chip for the record
        detail.
      </p>
      <DataGrid data={data ?? []} columns={columns} exportName="domains" />
    </div>
  );
}
