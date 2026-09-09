import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { ProfileProvider } from "@/lib/profile-context";
import { VideoDockProvider } from "@/components/class/video-dock";
import { ImpersonationBanner } from "@/components/shell/impersonation-banner";

/** App shell for all dashboard routes: /{role}/dashboard/{academyId}/…
 *  (URL model observed in Research Findings/Notes/00-tech-stack.md).
 *  requireProfile enforces the role/tenant match server-side. */
export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ role: string; academyId: string }>;
}) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);

  /* Manager capability flags drive which nav sections appear (Leads is
   * CEO-granted per manager). Fetched once here for the whole shell. */
  let perms: Record<string, boolean> | null = null;
  if (profile.role === "manager") {
    const supabase = await createClient();
    const { data } = await supabase
      .from("manager_permissions")
      .select("can_manage_leads, can_view_billing, can_schedule_classes, can_manage_students, can_view_reports, can_run_demos")
      .eq("profile_id", profile.id)
      .maybeSingle();
    perms = (data as Record<string, boolean> | null) ?? {};
  }

  return (
    <ProfileProvider value={profile}>
      {/* Full-bleed shell - dark icon rail flush left, workspace fills the
          rest of the viewport exactly. Cards/modals/buttons still carry the
          rounded, pastel, pop-shadowed look; only the outer chrome is
          edge-to-edge (no floating-panel gap).
          VideoDockProvider lives here, above the router, so classroom video
          survives navigating to another dashboard route (floats as a PiP card). */}
      <VideoDockProvider>
        <div className="flex h-screen overflow-hidden bg-surface-0">
          <Sidebar role={profile.role} academyId={profile.academy_id} perms={perms} />
          <div className="flex-1 flex flex-col min-w-0 bg-surface-1">
            <ImpersonationBanner role={profile.role} />
            <Topbar />
            <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">{children}</main>
          </div>
        </div>
      </VideoDockProvider>
    </ProfileProvider>
  );
}
