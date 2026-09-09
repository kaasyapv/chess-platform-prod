import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FolderDetailClient, type Pgn } from "./client";

type Row = { id: string; name: string; parent_id: string | null };

/** Walk parent_id up to the root so the page can show "Folders > Beginner >
 *  BM-1 > …" the way the reference breadcrumbs do. */
function crumbTrail(all: Row[], folderId: string): { id: string; name: string }[] {
  const byId = new Map(all.map((f) => [f.id, f]));
  const trail: { id: string; name: string }[] = [];
  let node = byId.get(folderId);
  while (node) {
    trail.unshift({ id: node.id, name: node.name });
    node = node.parent_id ? byId.get(node.parent_id) : undefined;
  }
  return trail;
}

export default async function FolderDetailPage({
  params,
}: {
  params: Promise<{ role: string; academyId: string; folderId: string }>;
}) {
  const { role, academyId, folderId } = await params;
  const profile = await requireProfile(role, academyId);
  const supabase = await createClient();

  const [pgns, all] = await Promise.all([
    supabase
      .from("pgns")
      .select("id, title, content, created_at, position")
      .eq("folder_id", folderId)
      .order("position").order("created_at"),
    supabase
      .from("pgn_folders")
      .select("id, name, parent_id")
      .eq("academy_id", academyId)
      .order("position"),
  ]);

  const folders = (all.data ?? []) as Row[];
  const trail = crumbTrail(folders, folderId);

  return (
    <FolderDetailClient
      me={profile}
      base={`/${role}/dashboard/${academyId}`}
      folderId={folderId}
      folderName={trail.at(-1)?.name ?? "Folder"}
      trail={trail}
      subfolders={folders.filter((f) => f.parent_id === folderId).map(({ id, name }) => ({ id, name }))}
      initialPgns={(pgns.data ?? []) as Pgn[]}
      folders={folders.map(({ id, name }) => ({ id, name }))}
    />
  );
}
