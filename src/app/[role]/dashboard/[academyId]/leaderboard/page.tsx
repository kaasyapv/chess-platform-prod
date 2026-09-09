import { requireProfile } from "@/lib/auth";
import { LeaderboardClient } from "./leaderboard-client";

export default async function LeaderboardPage({
  params,
}: { params: Promise<{ role: string; academyId: string }> }) {
  const { role, academyId } = await params;
  await requireProfile(role, academyId);
  return <LeaderboardClient />;
}
