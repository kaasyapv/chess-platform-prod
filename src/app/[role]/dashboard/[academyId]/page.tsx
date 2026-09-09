import { redirect } from "next/navigation";
import { requireProfile, dashboardPath } from "@/lib/auth";

/** `/{role}/dashboard/{academyId}` with no section had no page and 404'd.
 *  Every link in the app appends a slug, so this is only reached by a hand-
 *  typed or truncated URL - send it to the caller's own landing section
 *  instead of a dead end. requireProfile also corrects a role/academy segment
 *  that isn't theirs. */
export default async function DashboardIndex({
  params,
}: { params: Promise<{ role: string; academyId: string }> }) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);
  redirect(dashboardPath(profile));
}
