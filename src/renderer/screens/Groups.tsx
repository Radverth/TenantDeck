import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { invoke } from "../api";
import { DataGrid } from "../components/DataGrid";
import { Chip } from "../components/Chip";
import type { GroupRow } from "@shared/types";

const columns: ColumnDef<GroupRow, any>[] = [
  { accessorKey: "tenantName", header: "Tenant" },
  { accessorKey: "displayName", header: "Group" },
  { accessorKey: "groupType", header: "Type" },
  {
    accessorKey: "isTeam",
    header: "Team",
    cell: ({ getValue }) => (getValue() ? <Chip tone="accent">Team</Chip> : "—"),
  },
  { accessorKey: "visibility", header: "Visibility" },
  {
    accessorKey: "ownerCount",
    header: "Owners",
    cell: ({ getValue }) =>
      (getValue() as number) === 0 ? <Chip tone="fail">0</Chip> : getValue(),
  },
  { accessorKey: "memberCount", header: "Members" },
];

export default function Groups(): ReactNode {
  const [ownerlessOnly, setOwnerlessOnly] = useState(false);
  const { data } = useQuery({ queryKey: ["groups"], queryFn: () => invoke("data:groups", {}) });

  const filtered = (data ?? []).filter((g) => !ownerlessOnly || g.ownerCount === 0);

  return (
    <div>
      <h1>Groups & Teams</h1>
      <p className="subtitle">Security groups, M365 groups and Teams across tenants.</p>
      <DataGrid
        data={filtered}
        columns={columns}
        exportName="groups"
        toolbar={
          <label>
            <input
              type="checkbox"
              checked={ownerlessOnly}
              onChange={(e) => setOwnerlessOnly(e.target.checked)}
            />{" "}
            Ownerless only
          </label>
        }
      />
    </div>
  );
}
