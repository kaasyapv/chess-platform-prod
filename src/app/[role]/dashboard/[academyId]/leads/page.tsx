import { redirect } from "next/navigation";
import { requireProfile, dashboardPath } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LeadsShell } from "./leads-shell";
import type { TeleCrmPerms } from "../telecrm/telecrm-client";

const CEO_PERMS: TeleCrmPerms = { can_use_whatsapp: true, can_view_call_logs: true, can_manage_leads: true };

/** Leads CRM - pipeline board (ARCHITECTURE_V2.md §7) + TeleCRM as a tab
 *  beside it (native clone + Path A integration, formerly its own /telecrm
 *  route). CEO + managers only; RLS scopes managers without can_manage_leads
 *  to their own leads, and TeleCRM's own tabs are further gated per-manager
 *  by manager_permissions (see telecrm/page.tsx's prior logic, now here). */
export default async function LeadsPage({
  params,
}: { params: Promise<{ role: string; academyId: string }> }) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);
  if (profile.role !== "ceo" && profile.role !== "manager") {
    redirect(dashboardPath(profile));
  }

  let perms = CEO_PERMS;
  if (profile.role === "manager") {
    const supabase = await createClient();
    const { data } = await supabase.from("manager_permissions")
      .select("can_use_whatsapp, can_view_call_logs, can_manage_leads")
      .eq("profile_id", profile.id).maybeSingle();
    perms = {
      can_use_whatsapp: data?.can_use_whatsapp ?? false,
      can_view_call_logs: data?.can_view_call_logs ?? false,
      can_manage_leads: data?.can_manage_leads ?? false,
    };
  }

  /* Leads is opt-in for managers: the CEO grants can_manage_leads per person
   * (Academy -> Permissions). Without it there is nothing to show - RLS
   * already returns no rows - so send them away rather than render an empty
   * board that looks broken. */
  if (profile.role === "manager" && !perms.can_manage_leads) {
    redirect(dashboardPath(profile));
  }

  return <LeadsShell me={profile} perms={perms} />;
}
