"use client";

/* Academy Database - spacious centered search modal, opened from the
 * classroom's left toolbar "Import Database" button (Clone_reference/
 * Classroom_Report.docx, Figure 4 - originally a cramped 520px right-panel
 * drawer; moved out to give the board and move tree back their space).
 *
 * The reference platform's own Master Database is broken ("Unable to load
 * master database."). The layout here is a 1-to-1 match; the data comes from
 * this academy's own `pgns` table instead of the dead upstream service, so the
 * panel actually returns games. A failed query still shows the error + Retry
 * row the reference documents. */

import { useCallback, useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { pgnHeaders } from "@/lib/pgn";
import { Button, Input } from "@/components/ui";

type Row = { id: string; title: string; content: string };

const PAGE_SIZE = 20;
const COLUMNS = ["Date", "White", "Elo.W", "Black", "Elo.B", "Result", "ECO"];

export function MasterDatabase({
  academyId, open, onClose, onLoad,
}: {
  academyId: string; open: boolean; onClose: () => void;
  onLoad: (content: string, title: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [filters, setFilters] = useState({ white: "", black: "", eco: "" });
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const search = useCallback(async (toPage = 1) => {
    setBusy(true);
    setError(null);
    let q = createClient().from("pgns")
      .select("id, title, content", { count: "exact" })
      .eq("academy_id", academyId);

    if (query.trim()) q = q.ilike("title", `%${query.trim()}%`);
    // Header filters read the game text - the tags live inside `content`.
    if (filters.white.trim()) q = q.ilike("content", `%[White "%${filters.white.trim()}%"]%`);
    if (filters.black.trim()) q = q.ilike("content", `%[Black "%${filters.black.trim()}%"]%`);
    if (filters.eco.trim()) q = q.ilike("content", `%[ECO "%${filters.eco.trim()}%"]%`);

    const from = (toPage - 1) * PAGE_SIZE;
    const { data, count, error: err } = await q.order("title").range(from, from + PAGE_SIZE - 1);
    setBusy(false);
    if (err) { setError(err.message); setRows([]); setTotal(0); return; }
    setRows(data ?? []);
    setTotal(count ?? 0);
    setPage(toPage);
  }, [academyId, query, filters]);

  useEffect(() => { if (open) void search(1); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    // Spacious centered modal (was a 520px right-docked drawer) - opened from
    // the classroom's left toolbar "Import Database" button, not a tab.
    <div className="fixed inset-0 z-40 bg-scrim backdrop-blur-[3px] flex items-center justify-center p-4 no-print" onClick={onClose}>
      <div
        className="pop bg-surface-1 border border-border rounded-card shadow-pop w-full max-w-4xl h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 shrink-0 border-b border-border">
          <button onClick={onClose} aria-label="Close"
            className="w-7 h-7 rounded-btn flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-surface-2">
            <X size={16} />
          </button>
          <h2 className="text-lg font-semibold">Academy Database</h2>
          <span className="text-sm text-muted-foreground ml-1">Browse, search and load any game onto the board</span>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <Input className="flex-1" placeholder="Search..." value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search(1)} />
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer whitespace-nowrap">
              <input type="checkbox" checked={advanced} className="accent-[var(--primary)]"
                onChange={(e) => setAdvanced(e.target.checked)} />
              Advanced Filters
            </label>
          </div>

          {advanced && (
            <div className="grid grid-cols-3 gap-2">
              {(["white", "black", "eco"] as const).map((k) => (
                <Input key={k} placeholder={k === "eco" ? "ECO" : k === "white" ? "White" : "Black"}
                  value={filters[k]}
                  onChange={(e) => setFilters((f) => ({ ...f, [k]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && search(1)} />
              ))}
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={() => search(1)} disabled={busy}>
              <Search size={14} className="inline mr-1.5 -mt-0.5" />
              {busy ? "Searching…" : "Search"}
            </Button>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Showing {total} games</span>
            <span className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => search(page - 1)}
                className="w-6 h-6 rounded-btn disabled:opacity-30 hover:bg-surface-3">‹</button>
              <span className="tabular-nums text-muted-foreground">{page} / {pageCount}</span>
              <button disabled={page >= pageCount} onClick={() => search(page + 1)}
                className="w-6 h-6 rounded-btn disabled:opacity-30 hover:bg-surface-3">›</button>
            </span>
          </div>

          {error && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-warning">Unable to load master database.</p>
              <Button variant="secondary" className="!py-1 !px-3 text-sm" onClick={() => search(page)}>Retry</Button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5 min-h-0">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-1">
              <tr className="text-muted-foreground text-left">
                {COLUMNS.map((c) => <th key={c} className="font-normal py-2.5 pr-3 whitespace-nowrap">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="py-12 text-center text-muted-foreground">
                    {error ? "Unable to load games" : busy ? "Loading…" : "No games found"}
                  </td>
                </tr>
              ) : rows.map((r) => {
                const h = pgnHeaders(r.content);
                return (
                  <tr key={r.id}
                    onClick={() => onLoad(r.content, r.title)}
                    title={`Load "${r.title}" onto the board`}
                    className="border-t border-border cursor-pointer hover:bg-surface-2 transition-colors">
                    <td className="py-2.5 pr-3 whitespace-nowrap">{h.date ?? ""}</td>
                    <td className="py-2.5 pr-3 max-w-48 truncate">{h.white ?? r.title}</td>
                    <td className="py-2.5 pr-3 tabular-nums">{h.eloW ?? ""}</td>
                    <td className="py-2.5 pr-3 max-w-48 truncate">{h.black ?? ""}</td>
                    <td className="py-2.5 pr-3 tabular-nums">{h.eloB ?? ""}</td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">{h.result ?? ""}</td>
                    <td className="py-2.5 whitespace-nowrap">{h.eco ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
