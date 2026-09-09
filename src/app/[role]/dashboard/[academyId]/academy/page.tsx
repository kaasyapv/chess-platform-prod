import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AcademyClient, type Batch, type Invite, type Person } from "./client";

export default async function AcademyPage({
  params,
}: {
  params: Promise<{ role: string; academyId: string }>;
}) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);
  const supabase = await createClient();

  const [people, invites, batches, members] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, username, role, status, tags, created_at, coach_id, avatar")
      .eq("academy_id", academyId)
      .order("created_at", { ascending: false }),
    supabase
      .from("invites")
      .select("id, display_name, username, role, code, created_at")
      .eq("academy_id", academyId)
      .is("claimed_by", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("batches")
      .select("id, name, coach_id, created_at, coach:profiles!coach_id(display_name)")
      .eq("academy_id", academyId)
      .order("created_at", { ascending: false }),
    supabase.from("batch_members").select("batch_id, student_id"),
  ]);

  return (
    <AcademyClient
      me={profile}
      initialPeople={(people.data ?? []) as Person[]}
      initialInvites={(invites.data ?? []) as Invite[]}
      initialBatches={(batches.data ?? []) as unknown as Batch[]}
      initialMembers={(members.data ?? []) as { batch_id: string; student_id: string }[]}
    />
  );
}
