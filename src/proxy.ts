import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { canAccessSlug, slugNeedsPerm } from "@/lib/nav";
import type { Role } from "@/lib/auth";

const ROLES: string[] = ["ceo", "manager", "coach", "student"];

const PUBLIC_PATHS = [
  // "/" (marketing landing) is handled as an exact match below
  "/login",
  "/signup",
  "/onboarding",
  "/share",
  "/auth",
  "/api/health", // uptime probes
  "/api/billing/webhook", // gateway callbacks - verified by shared secret, not session
  "/api/webhooks", // razorpay gateway callbacks - signature verified
  "/robots.txt",
  "/sitemap.xml",
  "/sandbox", // internal UI proving ground - components only, no data
  "/diagnostics", // browser self-test - must run on a device that has never signed in
];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Env not wired yet (placeholder values) - let public pages work.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http")) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh the session (required by @supabase/ssr) and gate private routes.
  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  if (!user && path !== "/" && !PUBLIC_PATHS.some((p) => path.startsWith(p))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Section-level access: /{role}/dashboard/{academyId}/{slug}. Sections a role
  // has no nav entry for are genuinely closed to them, not just unlisted -
  // typing the URL lands back on their own dashboard. The role segment is
  // authoritative here because the layout's requireProfile() already redirects
  // anyone whose real profile doesn't match it, so a mismatched segment can
  // never render regardless of what this check decides.
  if (user) {
    const seg = path.split("/").filter(Boolean); // [role, "dashboard", academyId, slug, ...]
    if (seg.length >= 4 && seg[1] === "dashboard" && ROLES.includes(seg[0] as Role)) {
      const role = seg[0] as Role;

      /* Permission-gated sections need the manager's actual flags, or the
       * grant is meaningless: without them every gated slug looks denied, so
       * a manager the CEO explicitly granted Leads (or Billing) was still
       * bounced to /classrooms by this guard while the sidebar happily showed
       * them the link. That mismatch is what made "Payment History" land on
       * the classrooms list.
       *
       * The lookup only runs for a manager opening a gated section - a
       * handful of slugs - so the common request still costs no extra query. */
      let perms: Record<string, boolean> | undefined;
      if (role === "manager" && slugNeedsPerm(seg[3])) {
        const { data } = await supabase
          .from("manager_permissions")
          .select("*")
          .eq("profile_id", user.id)
          .maybeSingle();
        perms = (data as Record<string, boolean> | null) ?? {};
      }

      if (!canAccessSlug(role, seg[3], perms)) {
        return NextResponse.redirect(new URL(`/${seg[0]}/dashboard/${seg[2]}/classrooms`, request.url));
      }
    }
  }
  return response;
}

export const config = {
  // `mjs` must be here: the pdf.js worker ships as /pdf.worker.min.mjs and the
  // auth redirect on it (307) makes PdfCropper hang forever at "Rendering page…".
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|ico|css|js|mjs|wasm)$).*)"],
};
