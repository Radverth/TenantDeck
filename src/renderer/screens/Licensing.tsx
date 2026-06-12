import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { invoke } from "../api";
import { DataGrid } from "../components/DataGrid";
import { Chip } from "../components/Chip";
import type { LicenseSkuRow } from "@shared/types";

const columns: ColumnDef<LicenseSkuRow, any>[] = [
  { accessorKey: "tenantName", header: "Tenant" },
  { accessorKey: "friendlyName", header: "License" },
  { accessorKey: "skuPartNumber", header: "SKU" },
  { accessorKey: "purchased", header: "Purchased" },
  { accessorKey: "assigned", header: "Assigned" },
  {
    accessorKey: "unassigned",
    header: "Unassigned",
    cell: ({ getValue }) =>
      (getValue() as number) > 0 ? <Chip tone="warn">{getValue()}</Chip> : "0",
  },
];

export default function Licensing(): ReactNode {
  const { data } = useQuery({
    queryKey: ["licenses"],
    queryFn: () => invoke("data:licenses", {}),
  });

  const totalWaste = (data ?? []).reduce((n, s) => n + s.unassigned, 0);

  return (
    <div>
      <h1>Licensing Intelligence</h1>
      <p className="subtitle">
        SKU-to-friendly-name mapping, assigned vs purchased, and unassigned waste across the estate.
      </p>
      <div className="cards">
        <div className={`card${totalWaste > 0 ? " alert" : ""}`}>
          <div className="value">{totalWaste}</div>
          <div className="label">Total unassigned licenses (estate-wide)</div>
        </div>
      </div>
      <DataGrid data={data ?? []} columns={columns} exportName="licensing" />
    </div>
  );
}
