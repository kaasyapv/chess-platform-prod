/** Environment validation - one place that knows what the app needs.
 *  Reported by GET /api/health; import `checkEnv` anywhere else that must
 *  fail loudly. ponytail: plain checks, no zod - three vars don't need a schema. */

export type EnvReport = {
  ok: boolean;
  /** Required vars that are missing or still placeholders. App won't work without these. */
  missing: string[];
  /** Optional capabilities currently disabled and the var that enables each. */
  disabled: Record<string, string>;
};

export function checkEnv(): EnvReport {
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http"))
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.length < 20)
    missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const disabled: Record<string, string> = {};
  const provider = process.env.AI_PROVIDER === "openai" ? "openai" : "anthropic";
  const aiKey = provider === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!aiKey)
    disabled["ai (PDF/image extraction)"] =
      provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";

  // Classroom video needs all three: the URL to reach the SFU, and the key pair
  // to sign room tokens. Any one missing and the classroom falls back to "video
  // unavailable" rather than half-connecting.
  if (!process.env.NEXT_PUBLIC_LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET)
    disabled["classroom video"] = "NEXT_PUBLIC_LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET";

  return { ok: missing.length === 0, missing, disabled };
}
