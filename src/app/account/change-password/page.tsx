import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChangePasswordForm } from "./change-password-form";

/** Standalone (no dashboard shell) so it works as the first-login gate:
 *  requireProfile() and "/" redirect here while profiles.must_change_password
 *  is true. Deliberately does NOT call requireProfile - that would loop. */
export default async function ChangePasswordPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <ChangePasswordForm />;
}
