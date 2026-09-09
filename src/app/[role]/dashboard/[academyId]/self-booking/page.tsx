import { requireProfile } from "@/lib/auth";
import { SelfBookingClient } from "./booking-client";

export default async function SelfBookingPage({
  params,
}: { params: Promise<{ role: string; academyId: string }> }) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);
  return <SelfBookingClient profileId={profile.id} academyId={profile.academy_id} role={profile.role} />;
}
