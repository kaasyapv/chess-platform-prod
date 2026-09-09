import { requireProfile } from "@/lib/auth";
import { CalendarClient } from "./calendar-client";

export default async function CalendarPage({
  params,
}: { params: Promise<{ role: string; academyId: string }> }) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);
  return <CalendarClient me={profile} />;
}
