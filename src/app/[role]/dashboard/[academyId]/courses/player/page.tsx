import { requireProfile } from "@/lib/auth";
import { CoursePlayerClient } from "./player-client";

/** The course player demo. Nothing is fetched: the syllabus is a fixed
 *  reference playlist (see player-client.tsx), which is the point of the
 *  exercise -- the shape of the learning surface, before the content model
 *  behind it exists. */
export default async function CoursePlayerPage({
  params,
}: { params: Promise<{ role: string; academyId: string }> }) {
  const { role, academyId } = await params;
  await requireProfile(role, academyId);
  return <CoursePlayerClient base={`/${role}/dashboard/${academyId}`} />;
}
