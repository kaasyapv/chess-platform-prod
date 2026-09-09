import { requireProfile, STAFF_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TournamentsClient, type Player, type Tournament } from "./client";

export default async function TournamentsPage({
  params,
}: {
  params: Promise<{ role: string; academyId: string }>;
}) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);
  const supabase = await createClient();

  const [tournaments, players, students] = await Promise.all([
    supabase
      .from("tournaments")
      .select("id, title, kind, status, starts_at, time_control, created_at")
      .eq("academy_id", academyId)
      .order("created_at", { ascending: false }),
    supabase
      .from("tournament_players")
      .select("tournament_id, student_id, score, profile:profiles!student_id(display_name, username)"),
    supabase
      .from("profiles")
      .select("id, display_name")
      .eq("academy_id", academyId)
      .eq("role", "student")
      .order("display_name"),
  ]);

  return (
    <TournamentsClient
      me={profile}
      isStaff={STAFF_ROLES.includes(profile.role)}
      initialTournaments={(tournaments.data ?? []) as Tournament[]}
      initialPlayers={(players.data ?? []) as unknown as Player[]}
      students={(students.data ?? []) as { id: string; display_name: string }[]}
    />
  );
}
