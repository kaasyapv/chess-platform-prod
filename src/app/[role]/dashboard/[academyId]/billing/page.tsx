import { redirect } from "next/navigation";
import { requireProfile, dashboardPath } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BillingClient } from "./billing-client";
import { EarningsClient } from "./earnings-client";

/** "Payment History" means two different things depending on who asks.
 *
 *  People the academy PAYS -- coaches, and managers who have been penalised --
 *  get their own statement: sessions taught, penalties withheld, net payable.
 *  The CEO gets the academy's books, and so does a manager the CEO granted
 *  can_view_billing (that grant is what the permission is for; without it a
 *  manager still lands on their own statement rather than being bounced).
 *
 *  Students have no payment section at all: fees are handled off-platform and
 *  they see only their classes.
 */
export default async function BillingPage({
  params,
}: { params: Promise<{ role: string; academyId: string }> }) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);

  if (profile.role === "student" || profile.role === "coach") {
    if (profile.role === "student") redirect(dashboardPath(profile));
    return <EarningsClient me={profile} />;
  }

  if (profile.role === "manager") {
    const supabase = await createClient();
    const { data } = await supabase
      .from("manager_permissions")
      .select("can_view_billing")
      .eq("profile_id", profile.id)
      .maybeSingle();
    if (!data?.can_view_billing) return <EarningsClient me={profile} />;
  }

  return <BillingClient academyId={profile.academy_id} role={profile.role} />;
}
