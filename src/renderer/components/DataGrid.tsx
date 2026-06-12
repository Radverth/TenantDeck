import { useMemo, useState, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { exportCsv } from "../api";

interface DataGridProps<T> {
  data: T[];
  columns: ColumnDef<T, any>[];
  exportName?: string;
  toolbar?: ReactNode;
  emptyMessage?: string;
}

/**
 * Dense, sortable, filterable grid with one-click CSV export —
 * the workhorse of every TenantDeck screen.
 */
export function DataGrid<T>({
  data,
  columns,
  exportName,
  toolbar,
  emptyMessage = "No data yet — run a sync to populate this view.",
}: DataGridProps<T>): ReactNode {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filter, setFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: "includesString",
  });

  const rows = table.getRowModel().rows;

  const doExport = useMemo(
    () => async () => {
      const headers = table
        .getAllLeafColumns()
        .map((c) => (typeof c.columnDef.header === "string" ? c.columnDef.header : c.id));
      const body = rows.map((r) =>
        r.getAllCells().map((cell) => {
          const v = cell.getValue();
          if (v === null || v === undefined) return "";
          if (typeof v === "object") return JSON.stringify(v);
          return String(v);
        }),
      );
      await exportCsv(`${exportName ?? "export"}.csv`, headers, body);
    },
    [table, rows, exportName],
  );

  return (
    <div>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="muted">{rows.length} rows</span>
        <div className="spacer" />
        {toolbar}
        {exportName && (
          <button className="btn" onClick={doExport}>
            Export CSV
          </button>
        )}
      </div>
      <div className="grid-wrap">
        <table className="grid">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} onClick={h.column.getToggleSortingHandler()}>
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {{ asc: " ↑", desc: " ↓" }[h.column.getIsSorted() as string] ?? ""}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty">{emptyMessage}</div>}
      </div>
    </div>
  );
}
