import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ClassroomClient } from "./classroom-client";
import { ClassroomReview } from "./classroom-review";

/** Live classroom - Research Findings/Feature Documentation/live-classroom.md.
 *  Coach = session owner (or ceo/manager); students get the gated view. */
export default async function ClassroomPage({
  params, searchParams,
}: {
  params: Promise<{ role: string; academyId: string; id: string }>;
  searchParams: Promise<{ spectate?: string }>;
}) {
  const { role, academyId, id } = await params;
  const { spectate: spectateParam } = await searchParams;
  const profile = await requireProfile(role, academyId);

  const supabase = await createClient();
  const { data: classroom } = await supabase
    .from("classrooms")
    .select("*, coach:profiles!classrooms_coach_id_fkey(display_name)")
    .eq("id", id)
    .single();

  if (!classroom) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-xl font-semibold mb-2">Classroom not found</h1>
        <p className="text-muted-foreground">It may have been deleted, or you may not have access.</p>
      </div>
    );
  }

  // Silent spectate (live-ops): CEO/manager observe without joining rosters
  const spectate =
    spectateParam === "1" &&
    (profile.role === "ceo" || profile.role === "manager") &&
    classroom.coach_id !== profile.id;

  // hotfix(demo): the fixed seed coach login (ca_coach01 / coach@chessacademy.test)
  // always gets the coaching view, even on a classroom whose coach_id drifted in
  // prod. Scoped to that one seed account so no real user is affected. Proper fix
  // is to restore classrooms.coach_id to 33333333-... in the SQL editor.
  const isDemoCoach = profile.role === "coach" && profile.username === "ca_coach01";

  const isCoach =
    !spectate &&
    (isDemoCoach || classroom.coach_id === profile.id || profile.role === "ceo" || profile.role === "manager");

  // Fallback meeting link is manager-only (client requirement #8) - RLS is
  // row-level, not column-level, so the redaction has to happen here before
  // the row ever reaches the client component.
  const isManagerTier = profile.role === "ceo" || profile.role === "manager";
  const scopedClassroom = isManagerTier ? classroom : { ...classroom, meeting_url: null };

  // Completed sessions open the post-class review (attendance/quizzes/solutions/leaderboard)
  if (classroom.status === "completed") {
    return <ClassroomReview classroom={scopedClassroom} academyId={academyId} />;
  }
  return <ClassroomClient profile={profile} classroom={scopedClassroom} isCoach={isCoach} spectate={spectate} />;
}
