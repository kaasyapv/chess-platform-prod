import { headers } from "next/headers";
import { academySlugFromHost, getBranding } from "@/lib/branding";
import { LoginForm } from "./login-form";

/** Server shell: resolve the tenant from the request host (or `?slug=` for
 *  local/preview testing) and hand its branding to the client form. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string }>;
}) {
  const h = await headers();
  const { slug: slugOverride } = await searchParams;
  const slug = slugOverride?.trim() || academySlugFromHost(h.get("host"));
  const branding = await getBranding(slug);
  return <LoginForm branding={branding} />;
}
