import { requireProfile, STAFF_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SimulsClient, type Simul, type SimulPlayer } from "./client";

export default async function SimulsPage({
  params,
}: {
  params: Promise<{ role: string; academyId: string }>;
}) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);
  const supabase = await createClient();

  const [simuls, players, people] = await Promise.all([
    supabase
      .from("simuls")
      .select("id, title, status, starts_at, created_at, host:profiles!host_id(display_name)")
      .eq("academy_id", academyId)
      .order("created_at", { ascending: false }),
    supabase
      .from("simul_players")
      .select("simul_id, student_id, result, profile:profiles!student_id(display_name)"),
    supabase
      .from("profiles")
      .select("id, display_name, role")
      .eq("academy_id", academyId)
      .order("display_name"),
  ]);

  return (
    <SimulsClient
      me={profile}
      isStaff={STAFF_ROLES.includes(profile.role)}
      initialSimuls={(simuls.data ?? []) as unknown as Simul[]}
      initialPlayers={(players.data ?? []) as unknown as SimulPlayer[]}
      people={(people.data ?? []) as { id: string; display_name: string; role: string }[]}
    />
  );
}
