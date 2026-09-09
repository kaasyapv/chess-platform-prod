import { requireProfile } from "@/lib/auth";
import { LessonPlayer } from "./lesson-player";

export default async function LessonPage({
  params,
}: {
  params: Promise<{ role: string; academyId: string; id: string }>;
}) {
  const { role, academyId, id } = await params;
  const profile = await requireProfile(role, academyId);

  return <LessonPlayer academyId={academyId} role={role} lessonId={id} profileId={profile.id} />;
}
