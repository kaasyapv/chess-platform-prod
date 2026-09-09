import { requireProfile, STAFF_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { HomeworksClient, type Assignment, type Submission, type Template } from "./client";

export default async function HomeworksPage({
  params,
}: {
  params: Promise<{ role: string; academyId: string }>;
}) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);
  const supabase = await createClient();
  const isStaff = STAFF_ROLES.includes(profile.role);

  // Staff see the review queue (submitted); students see their own submissions.
  const submissionsQuery = supabase
    .from("homework_submissions")
    .select("id, assignment_id, answers, status, review_note, score, submitted_at, student_id, student:profiles!student_id(display_name), assignment:homework_assignments!assignment_id(title)")
    .order("submitted_at", { ascending: false });
  if (isStaff) submissionsQuery.eq("status", "submitted");
  else submissionsQuery.eq("student_id", profile.id);

  const [assignments, templates, submissions, batches, students] = await Promise.all([
    supabase
      .from("homework_assignments")
      .select("id, title, content, status, due_at, created_at, student_id, batch:batches!batch_id(name), student:profiles!student_id(display_name), submissions:homework_submissions(count)")
      .eq("academy_id", academyId)
      .order("created_at", { ascending: false }),
    supabase
      .from("homework_templates")
      .select("id, title, content, created_at")
      .eq("academy_id", academyId)
      .order("created_at", { ascending: false }),
    submissionsQuery,
    supabase.from("batches").select("id, name").eq("academy_id", academyId),
    // Only staff need the roster - it drives the "assign to one student" picker.
    isStaff
      ? supabase.from("profiles").select("id, display_name")
          .eq("academy_id", academyId).eq("role", "student").eq("status", "active")
          .order("display_name")
      : Promise.resolve({ data: [] }),
  ]);

  return (
    <HomeworksClient
      me={profile}
      isStaff={STAFF_ROLES.includes(profile.role)}
      initialAssignments={(assignments.data ?? []) as unknown as Assignment[]}
      initialTemplates={(templates.data ?? []) as Template[]}
      initialSubmissions={(submissions.data ?? []) as unknown as Submission[]}
      batches={(batches.data ?? []) as { id: string; name: string }[]}
      students={(students.data ?? []) as { id: string; display_name: string }[]}
    />
  );
}
