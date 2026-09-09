import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PuzzlesClient } from "./puzzles-client";

/** Puzzles - 10,000+ interactive tactics from the Lichess open puzzle DB
 *  (CC0). Any role can train; students' attempts are recorded for streaks. */
export default async function PuzzlesPage({
  params,
}: { params: Promise<{ role: string; academyId: string }> }) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);

  const supabase = await createClient();
  const { count } = await supabase.from("puzzles").select("*", { count: "exact", head: true });

  return <PuzzlesClient profile={profile} total={count ?? 0} />;
}
