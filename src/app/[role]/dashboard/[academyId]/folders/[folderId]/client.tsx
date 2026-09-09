"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { ChevronRight, Folder as FolderIcon, House } from "lucide-react";
import type { Profile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import { MiniBoard } from "@/components/board/mini-board";
import { pgnGameTitle, pgnInitialFen, splitPgnGames } from "@/lib/pgn";
import { loadPgnLenient } from "@/lib/pgn-load";
import {
  Button, EmptyState, Pagination, RowMenu, SearchInput, Select,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";

export type Pgn = { id: string; title: string; content: string; created_at: string; position: number };
type Node = { id: string; name: string };

const PAGE_SIZE = 18;

/** Split an uploaded .pgn into individual games, titled the way the library
 *  names them. Shared with the ingest script's rules via @/lib/pgn. */
function parsePgnFile(text: string, fallback: string): { title: string; content: string }[] {
  const games = splitPgnGames(text);
  const chunks = games.length ? games : [text.trim()].filter(Boolean);
  return chunks
    // splitPgnGames only looks for [Event] boundaries, so a file with no tags
    // at all comes back as a single "game" containing whatever was in it -
    // which is how prose, CSVs and half-downloaded files used to land in the
    // library as unopenable rows. Anything that can't be replayed is not a
    // game, and the caller reports it instead of storing it.
    .filter((content) => loadPgnLenient(content) !== null)
    .map((content, i) => ({ title: pgnGameTitle(content, fallback, i), content }));
}

export function FolderDetailClient({
  me, base, folderId, folderName, trail, subfolders, initialPgns, folders,
}: {
  me: Profile; base: string; folderId: string; folderName: string;
  trail: Node[]; subfolders: Node[];
  initialPgns: Pgn[]; folders: Node[];
}) {
  const supabase = createClient();
  const toast = useToast();
  const [pgns, setPgns] = useState(initialPgns);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [reorder, setReorder] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refetch() {
    const { data } = await supabase
      .from("pgns")
      .select("id, title, content, created_at, position")
      .eq("folder_id", folderId)
      .order("position").order("created_at");
    setPgns((data ?? []) as Pgn[]);
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = pgns.filter((p) => !q || p.title.toLowerCase().includes(q));
    return [...list].sort((a, b) => a.position - b.position);
  }, [pgns, search]);
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const rows = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function handleUpload(files: FileList | null) {
    if (!files?.length) return;
    const inserts: { academy_id: string; folder_id: string; title: string; content: string; created_by: string }[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(files)) {
      const text = await file.text();
      const games = parsePgnFile(text, file.name.replace(/\.pgn$/i, ""));
      // Name the file that failed - "no games found" across a multi-file
      // upload leaves you guessing which one was the bad export.
      if (games.length === 0) { rejected.push(file.name); continue; }
      for (const g of games) {
        inserts.push({
          academy_id: me.academy_id, folder_id: folderId,
          title: g.title, content: g.content, created_by: me.id,
        });
      }
    }
    if (inserts.length === 0) {
      return toast(
        rejected.length
          ? `No readable games in ${rejected.join(", ")}: is it a valid PGN export?`
          : "No games found in file",
        "error",
      );
    }
    const { error } = await supabase.from("pgns").insert(inserts);
    if (error) return toast(error.message, "error");
    toast(
      rejected.length
        ? `Uploaded ${inserts.length} PGN${inserts.length === 1 ? "" : "s"}, skipped ${rejected.join(", ")} (unreadable)`
        : `Uploaded ${inserts.length} PGN${inserts.length === 1 ? "" : "s"}`,
      rejected.length ? "info" : "success",
    );
    refetch();
  }

  async function deletePgn(p: Pgn) {
    const { error } = await supabase.from("pgns").delete().eq("id", p.id);
    if (error) return toast(error.message, "error");
    toast("PGN deleted", "success");
    refetch();
  }

  async function movePgn(p: Pgn, target: string) {
    const { error } = await supabase.from("pgns").update({ folder_id: target }).eq("id", p.id);
    if (error) return toast(error.message, "error");
    toast("PGN moved", "success");
    refetch();
  }

  const [moveTarget, setMoveTarget] = useState<Pgn | null>(null);

  /** Swap with neighbour and persist sequential positions (same approach as
   *  the folder grid - collections are small). */
  async function nudgePgn(p: Pgn, dir: -1 | 1) {
    const ordered = [...pgns].sort((a, b) => a.position - b.position);
    const idx = ordered.findIndex((x) => x.id === p.id);
    const j = idx + dir;
    if (j < 0 || j >= ordered.length) return;
    [ordered[idx], ordered[j]] = [ordered[j], ordered[idx]];
    const renumbered = ordered.map((x, i) => ({ ...x, position: i }));
    setPgns(renumbered);
    for (const x of renumbered) {
      const { error } = await supabase.from("pgns").update({ position: x.position }).eq("id", x.id);
      if (error) { toast(error.message, "error"); refetch(); return; }
    }
  }

  const empty = subfolders.length === 0 && pgns.length === 0;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{folderName}</h1>

      {/* Breadcrumbs - clickable at every level */}
      <nav className="flex items-center flex-wrap gap-1 text-sm mt-1 mb-6 text-muted-foreground">
        <Link href={`${base}/folders`} className="flex items-center gap-1.5 hover:text-foreground">
          <House size={14} /> Folders
        </Link>
        {trail.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1">
            <ChevronRight size={14} />
            {i === trail.length - 1
              ? <span className="text-foreground">{c.name}</span>
              : <Link href={`${base}/folders/${c.id}`} className="hover:text-foreground text-primary-hover">{c.name}</Link>}
          </span>
        ))}
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-sm text-muted-foreground">
          {subfolders.length > 0 && `${subfolders.length} folder${subfolders.length === 1 ? "" : "s"}`}
          {subfolders.length > 0 && pgns.length > 0 && " · "}
          {pgns.length > 0 && `${pgns.length} game${pgns.length === 1 ? "" : "s"}`}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {pgns.length > 0 && (
            <>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                Reorder games
                <input type="checkbox" checked={reorder}
                  onChange={(e) => setReorder(e.target.checked)}
                  className="accent-[var(--primary)]" />
              </label>
              <SearchInput placeholder="Search games…" value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            </>
          )}
          <input ref={fileRef} type="file" accept=".pgn" multiple hidden
            onChange={(e) => { handleUpload(e.target.files); e.target.value = ""; }} />
          <Button onClick={() => fileRef.current?.click()}>Upload PGN</Button>
        </div>
      </div>

      {/* Subfolders first, exactly as the platform drills down */}
      {subfolders.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {subfolders.map((f) => (
            <Link key={f.id} href={`${base}/folders/${f.id}`}
              className="flex items-center gap-3 bg-surface-2 border border-border rounded-card px-4 py-4 hover:border-primary/50 transition-colors min-w-0">
              <FolderIcon size={18} className="shrink-0 text-muted-foreground" />
              <span className="font-medium truncate">{f.name}</span>
            </Link>
          ))}
        </div>
      )}

      {empty && (
        <EmptyState text="This folder is empty. Upload a .pgn file to get started."
          action={<Button onClick={() => fileRef.current?.click()}>Upload PGN</Button>} />
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((p) => (
            <div key={p.id} className="bg-surface-2 border border-border rounded-card p-3 transition-all hover:border-primary/50 hover:shadow-lg">
              {/* The position the game starts from - never a replayed one */}
              <Link href={`${base}/folders/pgn/${p.id}`} className="block" title={`Open ${p.title}`}>
                <MiniBoard fen={pgnInitialFen(p.content)} className="mb-3" />
              </Link>
              <div className="flex items-start justify-between gap-2">
                <Link href={`${base}/folders/pgn/${p.id}`} className="font-semibold text-sm truncate hover:text-primary-hover">
                  {p.title}
                </Link>
                {reorder ? (
                  <span className="flex gap-1 shrink-0">
                    <button title="Move up" onClick={() => nudgePgn(p, -1)}
                      className="w-7 h-7 rounded-btn hover:bg-surface-3 text-muted-foreground">↑</button>
                    <button title="Move down" onClick={() => nudgePgn(p, 1)}
                      className="w-7 h-7 rounded-btn hover:bg-surface-3 text-muted-foreground">↓</button>
                  </span>
                ) : (
                  <RowMenu items={[
                    { label: "Move to…", onClick: () => setMoveTarget(p) },
                    { label: "Delete", onClick: () => deletePgn(p), danger: true },
                  ]} />
                )}
              </div>
              {moveTarget?.id === p.id && (
                <Select className="w-full mt-3 text-sm" defaultValue=""
                  onChange={(e) => { if (e.target.value) movePgn(p, e.target.value); setMoveTarget(null); }}>
                  <option value="" disabled>Move to folder…</option>
                  {folders.filter((f) => f.id !== folderId).map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </Select>
              )}
            </div>
          ))}
        </div>
      )}

      {pgns.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground mt-4">{PAGE_SIZE} / page</span>
          <Pagination page={page} pageCount={pageCount} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
