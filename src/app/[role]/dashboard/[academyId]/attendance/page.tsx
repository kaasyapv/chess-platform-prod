import { requireProfile } from "@/lib/auth";
import { AttendanceClient } from "./attendance-client";

export default async function AttendancePage({
  params,
}: { params: Promise<{ role: string; academyId: string }> }) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);
  return <AttendanceClient academyId={profile.academy_id} markerId={profile.id} />;
}
