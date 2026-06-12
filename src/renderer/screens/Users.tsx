import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { invoke } from "../api";
import { DataGrid } from "../components/DataGrid";
import { Chip } from "../components/Chip";
import type { UserRow } from "@shared/types";

const columns: ColumnDef<UserRow, any>[] = [
  { accessorKey: "tenantName", header: "Tenant" },
  { accessorKey: "userPrincipalName", header: "UPN" },
  { accessorKey: "displayName", header: "Display name" },
  {
    accessorKey: "accountEnabled",
    header: "Enabled",
    cell: ({ getValue }) => (getValue() ? "Yes" : <Chip tone="neutral">disabled</Chip>),
  },
  {
    accessorKey: "licensed",
    header: "Licensed",
    cell: ({ getValue }) => (getValue() ? "Yes" : "—"),
  },
  {
    accessorKey: "adminRoles",
    header: "Admin roles",
    cell: ({ getValue }) => (getValue() as string[]).join(", ") || "—",
  },
  {
    accessorKey: "mfaRegistered",
    header: "MFA",
    cell: ({ getValue }) => {
      const v = getValue();
      if (v === null) return <Chip tone="neutral">unknown</Chip>;
      return v ? <Chip tone="pass">registered</Chip> : <Chip tone="fail">missing</Chip>;
    },
  },
  {
    accessorKey: "lastSignInAt",
    header: "Last sign-in",
    cell: ({ getValue }) => (getValue() ? new Date(getValue()).toLocaleDateString() : "—"),
  },
];

type SavedView = "all" | "adminsNoMfa" | "stale" | "unlicensed";

export default function Users(): ReactNode {
  const [view, setView] = useState<SavedView>("all");
  const { data } = useQuery({ queryKey: ["users"], queryFn: () => invoke("data:users", {}) });

  const cutoff = Date.now() - 90 * 86_400_000;
  const filtered = (data ?? []).filter((u) => {
    switch (view) {
      case "adminsNoMfa":
        return u.adminRoles.length > 0 && u.mfaRegistered === false;
      case "stale":
        return u.lastSignInAt !== null && new Date(u.lastSignInAt).getTime() < cutoff;
      case "unlicensed":
        return !u.licensed && u.accountEnabled;
      default:
        return true;
    }
  });

  return (
    <div>
      <h1>Identity & Users</h1>
      <p className="subtitle">Cross-tenant user inventory from the local cache.</p>
      <DataGrid
        data={filtered}
        columns={columns}
        exportName="users"
        toolbar={
          <select value={view} onChange={(e) => setView(e.target.value as SavedView)}>
            <option value="all">All users</option>
            <option value="adminsNoMfa">Admins without MFA</option>
            <option value="stale">Stale (90+ days)</option>
            <option value="unlicensed">Enabled but unlicensed</option>
          </select>
        }
      />
    </div>
  );
}
