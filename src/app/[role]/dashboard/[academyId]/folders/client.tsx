"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Folder as FolderIcon, FolderLock } from "lucide-react";
import type { Profile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import {
  Button, EmptyState, Input, Modal, PageHeader, Pagination, RowMenu,
  SearchInput, Select,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";

export type Folder = {
  id: string; name: string; created_at: string; position: number;
};

const PAGE_SIZE = 18;

export function FoldersClient({
  me, base, initialFolders,
}: { me: Profile; base: string; initialFolders: Folder[] }) {
  const supabase = createClient();
  const toast = useToast();
  const [folders, setFolders] = useState(initialFolders);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("none");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameTarget, setRenameTarget] = useState<Folder | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [reorder, setReorder] = useState(false);

  async function refetch() {
    const { data } = await supabase
      .from("pgn_folders")
      .select("id, name, created_at, position")
      .eq("academy_id", me.academy_id)
      .is("parent_id", null)
      .order("position").order("created_at");
    setFolders((data ?? []) as unknown as Folder[]);
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = folders.filter((f) => !q || f.name.toLowerCase().includes(q));
    // "None" (the default) keeps the platform's own curriculum order.
    if (reorder || sort === "none") return [...list].sort((a, b) => a.position - b.position);
    return [...list].sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name, undefined, { numeric: true })
        : +new Date(b.created_at) - +new Date(a.created_at),
    );
  }, [folders, search, sort, reorder]);
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const rows = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function createFolder() {
    if (!newName.trim()) return toast("Enter a folder name", "error");
    const { error } = await supabase.from("pgn_folders").insert({
      academy_id: me.academy_id, name: newName.trim(),
    });
    if (error) return toast(error.message, "error");
    setCreateOpen(false); setNewName("");
    toast("Folder created", "success");
    refetch();
  }

  async function renameFolder() {
    if (!renameTarget || !renameValue.trim()) return;
    const { error } = await supabase.from("pgn_folders")
      .update({ name: renameValue.trim() }).eq("id", renameTarget.id);
    if (error) return toast(error.message, "error");
    setRenameTarget(null);
    toast("Folder renamed", "success");
    refetch();
  }

  /** Swap with the neighbour, then persist sequential positions (folder
   *  counts are small, so rewriting all positions keeps ordering robust). */
  async function moveFolder(f: Folder, dir: -1 | 1) {
    const ordered = [...folders].sort((a, b) => a.position - b.position);
    const idx = ordered.findIndex((x) => x.id === f.id);
    const j = idx + dir;
    if (j < 0 || j >= ordered.length) return;
    [ordered[idx], ordered[j]] = [ordered[j], ordered[idx]];
    const renumbered = ordered.map((x, i) => ({ ...x, position: i }));
    setFolders(renumbered);
    for (const x of renumbered) {
      const { error } = await supabase.from("pgn_folders").update({ position: x.position }).eq("id", x.id);
      if (error) { toast(error.message, "error"); refetch(); return; }
    }
  }

  async function deleteFolder(f: Folder) {
    const { error } = await supabase.from("pgn_folders").delete().eq("id", f.id);
    if (error) return toast(error.message, "error");
    toast("Folder deleted", "success");
    refetch();
  }

  return (
    <div>
      <PageHeader
        title="PGN Library"
        subtitle="Manage folders and PGNs for structured storage and easy access"
        action={<Button onClick={() => setCreateOpen(true)}>+ New Folder</Button>}
      />
      <div className="flex flex-wrap items-center justify-end gap-3 mb-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          Reorder folders and pgns
          <input
            type="checkbox"
            checked={reorder}
            onChange={(e) => setReorder(e.target.checked)}
            className="accent-[var(--primary)]"
          />
        </label>
        <SearchInput placeholder="Search folders and PGNs…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <Select value={sort} onChange={(e) => setSort(e.target.value)} disabled={reorder}>
          <option value="none">None</option>
          <option value="name">Name</option>
          <option value="newest">Newest</option>
        </Select>
      </div>

      {rows.length === 0 ? (
        <EmptyState text="No folders yet. Create one to start your PGN library."
          action={<Button onClick={() => setCreateOpen(true)}>+ New Folder</Button>} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Read-only on the platform: a coach account cannot open it. */}
          {page === 1 && !search.trim() && (
            <div
              title="The public database is not available to this account."
              className="flex items-center gap-3 bg-surface-3 border border-border rounded-card px-4 py-4 opacity-60 cursor-not-allowed"
            >
              <FolderLock size={18} className="shrink-0 text-muted-foreground" />
              <span className="font-medium truncate">Public</span>
            </div>
          )}
          {rows.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-2 bg-surface-2 border border-border rounded-card px-4 py-4 hover:border-primary/50 transition-colors">
              <Link href={`${base}/folders/${f.id}`} className="flex items-center gap-3 min-w-0">
                <FolderIcon size={18} className="shrink-0 text-muted-foreground" />
                <span className="font-medium truncate">{f.name}</span>
              </Link>
              {reorder ? (
                <span className="flex gap-1 shrink-0">
                  <button title="Move up" onClick={() => moveFolder(f, -1)}
                    className="w-8 h-8 rounded-btn hover:bg-surface-3 text-muted-foreground">↑</button>
                  <button title="Move down" onClick={() => moveFolder(f, 1)}
                    className="w-8 h-8 rounded-btn hover:bg-surface-3 text-muted-foreground">↓</button>
                </span>
              ) : (
                <RowMenu items={[
                  { label: "Rename", onClick: () => { setRenameTarget(f); setRenameValue(f.name); } },
                  { label: "Delete", onClick: () => deleteFolder(f), danger: true },
                ]} />
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground mt-4">{PAGE_SIZE}/page</span>
        <Pagination page={page} pageCount={pageCount} onPage={setPage} />
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Folder">
        <div className="space-y-4">
          <Input className="w-full" value={newName} placeholder="Folder name" autoFocus
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createFolder()} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createFolder}>Create</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!renameTarget} onClose={() => setRenameTarget(null)} title="Rename Folder">
        <div className="space-y-4">
          <Input className="w-full" value={renameValue} autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && renameFolder()} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button onClick={renameFolder}>Rename</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
