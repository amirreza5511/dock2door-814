"use client";

import * as React from "react";
import { Input } from "./input";
import { Button } from "./button";
import { Table, THead, TBody, TR, TH, TD } from "./table";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  className?: string;
  render: (row: T) => React.ReactNode;
  sortable?: boolean;
  sortValue?: (row: T) => string | number | null;
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  isLoading?: boolean;
  error?: Error | null;
  searchPlaceholder?: string;
  searchPredicate?: (row: T, q: string) => boolean;
  filters?: { value: string; label: string; predicate: (row: T) => boolean }[];
  pageSize?: number;
  emptyMessage?: string;
  bulkActions?: {
    label: string;
    variant?: "default" | "destructive" | "secondary";
    onRun: (rows: T[]) => Promise<void> | void;
  }[];
  selectable?: boolean;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  isLoading,
  error,
  searchPlaceholder = "Search…",
  searchPredicate,
  filters,
  pageSize = 25,
  emptyMessage = "No records found.",
  bulkActions,
  selectable,
}: DataTableProps<T>) {
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [sortKey, setSortKey] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc");
  const [busy, setBusy] = React.useState(false);

  const filtered = React.useMemo(() => {
    let out = rows;
    if (filter !== "all" && filters) {
      const f = filters.find((x) => x.value === filter);
      if (f) out = out.filter(f.predicate);
    }
    if (q && searchPredicate) {
      const needle = q.toLowerCase();
      out = out.filter((r) => searchPredicate(r, needle));
    } else if (q) {
      const needle = q.toLowerCase();
      out = out.filter((r) => JSON.stringify(r).toLowerCase().includes(needle));
    }
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      if (col?.sortValue) {
        out = [...out].sort((a, b) => {
          const va = col.sortValue!(a);
          const vb = col.sortValue!(b);
          if (va == null) return 1;
          if (vb == null) return -1;
          if (va < vb) return sortDir === "asc" ? -1 : 1;
          if (va > vb) return sortDir === "asc" ? 1 : -1;
          return 0;
        });
      }
    }
    return out;
  }, [rows, filter, filters, q, searchPredicate, sortKey, sortDir, columns]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const selectedRows = React.useMemo(() => filtered.filter((r) => selected[rowKey(r)]), [filtered, selected, rowKey]);
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected[rowKey(r)]);

  React.useEffect(() => { setPage(1); }, [q, filter]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-64"
          placeholder={searchPlaceholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {filters && filters.length > 0 && (
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm shadow-sm"
          >
            <option value="all">All</option>
            {filters.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        )}
        <div className="ml-auto text-xs text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? "row" : "rows"}
        </div>
      </div>

      {selectable && bulkActions && bulkActions.length > 0 && selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span>{selectedRows.length} selected</span>
          {bulkActions.map((a) => (
            <Button
              key={a.label}
              size="sm"
              variant={a.variant ?? "default"}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try { await a.onRun(selectedRows); setSelected({}); }
                finally { setBusy(false); }
              }}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <THead>
            <TR>
              {selectable && (
                <TH className="w-8">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={(e) => {
                      const next = { ...selected };
                      pageRows.forEach((r) => { next[rowKey(r)] = e.target.checked; });
                      setSelected(next);
                    }}
                  />
                </TH>
              )}
              {columns.map((c) => (
                <TH
                  key={c.key}
                  className={cn(c.className, c.sortable && "cursor-pointer select-none")}
                  onClick={c.sortable ? () => toggleSort(c.key) : undefined}
                >
                  {c.header}
                  {sortKey === c.key && <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {isLoading ? (
              <TR><TD colSpan={columns.length + (selectable ? 1 : 0)} className="p-6 text-center text-sm text-muted-foreground">Loading…</TD></TR>
            ) : error ? (
              <TR><TD colSpan={columns.length + (selectable ? 1 : 0)} className="p-6 text-center text-sm text-red-600">{error.message}</TD></TR>
            ) : pageRows.length === 0 ? (
              <TR><TD colSpan={columns.length + (selectable ? 1 : 0)} className="p-6 text-center text-sm text-muted-foreground">{emptyMessage}</TD></TR>
            ) : pageRows.map((r) => {
              const k = rowKey(r);
              return (
                <TR key={k}>
                  {selectable && (
                    <TD>
                      <input
                        type="checkbox"
                        checked={!!selected[k]}
                        onChange={(e) => setSelected({ ...selected, [k]: e.target.checked })}
                      />
                    </TD>
                  )}
                  {columns.map((c) => (
                    <TD key={c.key} className={c.className}>{c.render(r)}</TD>
                  ))}
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {safePage} of {totalPages}</span>
          <div className="space-x-2">
            <Button size="sm" variant="secondary" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Prev</Button>
            <Button size="sm" variant="secondary" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
