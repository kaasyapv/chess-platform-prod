import { requireProfile, STAFF_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CoursesClient, type Course, type Lesson } from "./client";

export default async function CoursesPage({
  params,
}: {
  params: Promise<{ role: string; academyId: string }>;
}) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);
  const supabase = await createClient();

  const [courses, lessons] = await Promise.all([
    supabase
      .from("courses")
      .select("id, title, description, tags, status, created_at")
      .eq("academy_id", academyId)
      .order("created_at", { ascending: false }),
    supabase
      .from("lessons")
      .select("id, course_id, title, kind, position, status")
      .eq("academy_id", academyId)
      .order("position"),
  ]);

  return (
    <CoursesClient
      me={profile}
      isStaff={STAFF_ROLES.includes(profile.role)}
      base={`/${role}/dashboard/${academyId}`}
      initialCourses={(courses.data ?? []) as Course[]}
      lessons={(lessons.data ?? []) as Lesson[]}
    />
  );
}
