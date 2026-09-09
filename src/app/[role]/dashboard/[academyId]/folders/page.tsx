import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FoldersClient, type Folder } from "./client";

export default async function FoldersPage({
  params,
}: {
  params: Promise<{ role: string; academyId: string }>;
}) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);
  const supabase = await createClient();

  // Root view: only top-level folders. Subfolders are reached by drilling in.
  const { data } = await supabase
    .from("pgn_folders")
    .select("id, name, created_at, position")
    .eq("academy_id", academyId)
    .is("parent_id", null)
    .order("position")
    .order("created_at");

  return (
    <FoldersClient
      me={profile}
      base={`/${role}/dashboard/${academyId}`}
      initialFolders={(data ?? []) as unknown as Folder[]}
    />
  );
}
