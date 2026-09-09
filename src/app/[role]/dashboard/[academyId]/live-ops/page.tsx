import { redirect } from "next/navigation";
import { requireProfile, dashboardPath } from "@/lib/auth";
import { LiveOpsClient } from "./live-ops-client";

/** Live Operations - lichess.org/games-style wall of every active class.
 *  CEO + managers. One realtime subscription total (ARCHITECTURE_V2.md §3). */
export default async function LiveOpsPage({
  params,
}: { params: Promise<{ role: string; academyId: string }> }) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);
  if (profile.role !== "ceo" && profile.role !== "manager") {
    redirect(dashboardPath(profile));
  }
  return (
    <LiveOpsClient
      academyId={academyId}
      role={role}
      profileId={profile.id}
      profileName={profile.display_name}
    />
  );
}
