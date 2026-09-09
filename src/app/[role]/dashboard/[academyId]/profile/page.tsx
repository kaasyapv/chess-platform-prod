import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ProfileClient } from "./profile-client";

export default async function ProfilePage({
  params,
}: { params: Promise<{ role: string; academyId: string }> }) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);
  const supabase = await createClient();
  const { data: academy } = await supabase.from("academies").select("name").eq("id", academyId).single();
  return <ProfileClient profile={profile} academyName={academy?.name ?? ""} />;
}
