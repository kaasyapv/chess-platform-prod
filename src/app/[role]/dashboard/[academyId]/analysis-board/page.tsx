import { requireProfile } from "@/lib/auth";
import { AnalysisClient } from "./analysis-client";

export default async function AnalysisBoardPage({
  params,
}: { params: Promise<{ role: string; academyId: string }> }) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);
  // Students study positions themselves; the engine is a staff tool.
  return <AnalysisClient profileId={profile.id} academyId={profile.academy_id} allowEngine={profile.role !== "student"} />;
}
