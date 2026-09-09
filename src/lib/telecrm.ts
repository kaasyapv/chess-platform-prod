/** Pure logic behind the TeleCRM dashboard - kept out of the client component
 *  so lead distribution and drip scheduling are testable without a browser or
 *  a live Supabase project (mirrors src/lib/help-queue.ts). */

export type DistributionRule = { agent_id: string; weight_percent: number; active: boolean };

/** Weighted round-robin pick for the next inbound lead. Inactive rules are
 *  ignored; weights don't need to sum to 100 (normalized against the total). */
export function pickDistributionAgent(
  rules: DistributionRule[],
  rand: () => number = Math.random,
): string | null {
  const active = rules.filter((r) => r.active && r.weight_percent > 0);
  const total = active.reduce((sum, r) => sum + r.weight_percent, 0);
  if (total <= 0) return null;
  let roll = rand() * total;
  for (const r of active) {
    roll -= r.weight_percent;
    if (roll <= 0) return r.agent_id;
  }
  return active[active.length - 1].agent_id; // floating-point fallback
}

export type DripStep = { delay_hours: number; template_name: string };

/** When the next drip step should fire, given the enrollment's anchor time
 *  (either enrolled_at for step 0, or the previous step's send time). */
export function nextDripSendAt(from: Date, step: DripStep): Date {
  return new Date(from.getTime() + step.delay_hours * 3_600_000);
}

export type CallOutcome = "connected" | "no_answer" | "voicemail" | "busy" | "wrong_number";

/** A lead needs a follow-up call if the last attempt didn't connect and it's
 *  been at least `cooldownHours` since - drives the "needs a call" badge in
 *  the TeleCRM Call Logs tab. */
export function needsFollowUpCall(
  lastCall: { outcome: CallOutcome; started_at: string } | null,
  now: Date,
  cooldownHours = 4,
): boolean {
  if (!lastCall) return true;
  if (lastCall.outcome === "connected") return false;
  return now.getTime() - +new Date(lastCall.started_at) >= cooldownHours * 3_600_000;
}
