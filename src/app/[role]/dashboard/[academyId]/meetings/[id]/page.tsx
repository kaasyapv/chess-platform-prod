import { redirect } from "next/navigation";
import { requireProfile, dashboardPath } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MeetingRoomClient } from "./meeting-room-client";

/** The platform's own meeting room.
 *
 *  There is nothing to provision: the video mesh is keyed by room id, so a
 *  meeting's id IS its room. Access is decided by RLS -- meetings_read only
 *  returns a row to its organiser or an invitee -- so a link forwarded to
 *  someone who was not invited simply finds no meeting and bounces.
 */
export default async function MeetingRoomPage({
  params,
}: { params: Promise<{ role: string; academyId: string; id: string }> }) {
  const { role, academyId, id } = await params;
  const profile = await requireProfile(role, academyId);

  const supabase = await createClient();
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, title, agenda, starts_at, duration_minutes, location_kind, external_url, status, organizer:profiles!meetings_organizer_id_fkey(display_name)")
    .eq("id", id)
    .maybeSingle();

  if (!meeting) redirect(dashboardPath(profile, "calendar"));

  return (
    <MeetingRoomClient
      me={profile}
      meeting={{
        ...meeting,
        organizer: meeting.organizer as unknown as { display_name: string } | null,
      }}
    />
  );
}
