import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { dashboardPath } from "@/lib/auth";
import { Landing } from "@/components/marketing/landing";

/** "/" - marketing landing for visitors; signed-in users go straight to
 *  their role dashboard (previous deep-link behavior preserved). */
export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, academy_id, must_change_password")
      .eq("id", user.id)
      .single();
    if (!profile) redirect("/onboarding");
    if (profile.must_change_password) redirect("/account/change-password");
    redirect(dashboardPath(profile));
  }
  return <Landing />;
}
