import { requireProfile } from "@/lib/auth";
import { PlayAreaClient } from "./play-client";

export default async function PlayAreaPage({
  params,
}: { params: Promise<{ role: string; academyId: string }> }) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);
  return <PlayAreaClient profileId={profile.id} academyId={profile.academy_id} />;
}
