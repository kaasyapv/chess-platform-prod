import { redirect } from "next/navigation";
import { requireProfile, dashboardPath, STAFF_ROLES } from "@/lib/auth";
import { InsightsClient } from "./insights-client";

/** Game Insights - pull a student's chess.com / Lichess games and study them.
 *  Coach tooling: manager sees operations, students get their own puzzles. */
export default async function InsightsPage({
  params,
}: { params: Promise<{ role: string; academyId: string }> }) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);
  if (!STAFF_ROLES.includes(profile.role) || profile.role === "manager") {
    redirect(dashboardPath(profile));
  }
  return <InsightsClient base={`/${role}/dashboard/${academyId}`} />;
}
