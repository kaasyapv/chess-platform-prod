import { NextResponse } from "next/server";
import { checkEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/** Liveness + config probe for deploys and uptime monitors.
 *  200 = env complete and database reachable; 503 otherwise.
 *  Reports names of missing vars only - never values. */

export async function GET() {
  const env = checkEnv();
  let db: "ok" | "unreachable" | "unconfigured" = "unconfigured";
  if (env.ok) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.from("academies").select("id", { head: true, count: "exact" }).limit(1);
      db = error ? "unreachable" : "ok";
    } catch {
      db = "unreachable";
    }
  }
  const healthy = env.ok && db === "ok";
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", db, env },
    { status: healthy ? 200 : 503 },
  );
}
