import { requireProfile } from "@/lib/auth";
import { PenaltiesClient } from "./penalties-client";

export default async function PenaltiesPage({
  params,
}: { params: Promise<{ role: string; academyId: string }> }) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);
  return <PenaltiesClient me={profile} />;
}
