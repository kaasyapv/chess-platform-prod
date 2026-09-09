import { requireProfile, STAFF_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  CurriculumLevel, CurriculumLesson, CurriculumActivity, CurriculumProgress,
} from "@/lib/curriculum";
import { CurriculumClient } from "./client";

export default async function CurriculumPage({
  params,
}: {
  params: Promise<{ role: string; academyId: string }>;
}) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);
  const supabase = await createClient();
  const isStaff = STAFF_ROLES.includes(profile.role);

  const [levels, lessons, activities, progress] = await Promise.all([
    supabase.from("curriculum_levels")
      .select("id, academy_id, title, ordinal, description, created_by, created_at")
      .eq("academy_id", academyId).order("ordinal"),
    supabase.from("curriculum_lessons")
      .select("id, level_id, academy_id, title, ordinal, objective, created_at")
      .eq("academy_id", academyId).order("ordinal"),
    supabase.from("curriculum_activities")
      .select("id, lesson_id, academy_id, ordinal, kind, title, prompt, fen, pgn, answer, choices, meta, created_at")
      .eq("academy_id", academyId).order("ordinal"),
    // Students see their own row set; staff get an empty list (they review via the DB).
    isStaff
      ? Promise.resolve({ data: [] as CurriculumProgress[] })
      : supabase.from("curriculum_progress")
          .select("student_id, activity_id, status, score, attempts, time_ms, updated_at")
          .eq("student_id", profile.id),
  ]);

  return (
    <CurriculumClient
      academyId={academyId}
      studentId={profile.id}
      isStaff={isStaff}
      levels={(levels.data ?? []) as CurriculumLevel[]}
      lessons={(lessons.data ?? []) as CurriculumLesson[]}
      activities={(activities.data ?? []) as CurriculumActivity[]}
      progress={(progress.data ?? []) as CurriculumProgress[]}
    />
  );
}
