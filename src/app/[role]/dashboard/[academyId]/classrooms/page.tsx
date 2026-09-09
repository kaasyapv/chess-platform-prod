import { requireProfile, STAFF_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ClassroomsClient, type Classroom, type Series } from "./client";

export default async function ClassroomsPage({
  params,
}: {
  params: Promise<{ role: string; academyId: string }>;
}) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);
  const supabase = await createClient();

  // A coach can self-schedule 1:1 classes for the students assigned to them
  // (profiles.coach_id) - see migration 0041. Admins pick from batches instead.
  const canSelfSchedule = profile.role === "coach";

  // Staff see the whole academy schedule; a student only sees classes they're
  // actually in - enrolled directly (classroom_enrollments) or via their batch.
  const isStudent = profile.role === "student";

  const [classes, series, batches, courses, myStudents, myEnrollments, myBatches] = await Promise.all([
    supabase
      .from("classrooms")
      .select("id, title, status, scheduled_at, duration_minutes, started_at, coach_id, batch_id, series_id, course_id, coach:profiles!coach_id(display_name), classroom_enrollments(count)")
      .eq("academy_id", academyId)
      .order("scheduled_at", { ascending: false }),
    supabase
      .from("classroom_series")
      .select("id, title, created_at, coach:profiles!coach_id(display_name)")
      .eq("academy_id", academyId)
      .order("created_at", { ascending: false }),
    supabase.from("batches").select("id, name").eq("academy_id", academyId),
    supabase.from("courses").select("id, title").eq("academy_id", academyId),
    canSelfSchedule
      ? supabase.from("profiles").select("id, display_name")
          .eq("academy_id", academyId).eq("role", "student").eq("coach_id", profile.id)
      : Promise.resolve({ data: [] }),
    isStudent
      ? supabase.from("classroom_enrollments").select("classroom_id").eq("student_id", profile.id)
      : Promise.resolve({ data: [] }),
    isStudent
      ? supabase.from("batch_members").select("batch_id").eq("student_id", profile.id)
      : Promise.resolve({ data: [] }),
  ]);

  let classList = (classes.data ?? []) as unknown as Classroom[];
  if (isStudent) {
    const okClass = new Set((myEnrollments.data ?? []).map((e: { classroom_id: string }) => e.classroom_id));
    const okBatch = new Set((myBatches.data ?? []).map((b: { batch_id: string }) => b.batch_id));
    classList = classList.filter((c) => okClass.has(c.id) || (c.batch_id != null && okBatch.has(c.batch_id)));
  }

  return (
    <ClassroomsClient
      me={profile}
      isStaff={STAFF_ROLES.includes(profile.role)}
      canManageSchedule={profile.role === "ceo" || profile.role === "manager"}
      canSelfSchedule={canSelfSchedule}
      base={`/${role}/dashboard/${academyId}`}
      initialClasses={classList}
      series={(series.data ?? []) as unknown as Series[]}
      batches={(batches.data ?? []) as { id: string; name: string }[]}
      courses={(courses.data ?? []) as { id: string; title: string }[]}
      myStudents={(myStudents.data ?? []) as { id: string; display_name: string }[]}
    />
  );
}
