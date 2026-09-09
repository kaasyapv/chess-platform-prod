"use client";

/* Genuine activity tracking.
 *
 * The point of this is that "active hours" must mean time actually spent
 * working or learning. Login-to-logout is worthless - a tab left open
 * overnight would read as an eight-hour shift, and a coach who genuinely
 * taught for 40 minutes and closed the laptop would read as nothing.
 *
 * So the heartbeat only fires while the person is interacting: real input
 * (pointer/key/scroll) inside the last IDLE_AFTER window, on a visible tab.
 * Each heartbeat states the seconds it accounts for, so summing them gives an
 * honest total. Going quiet writes one 'idle' row and stops - no further
 * 'active' seconds accrue until they come back.
 *
 * Feature events (started a class, opened the whiteboard) go into the same
 * stream, so the Full Report can show a readable timeline instead of a number
 * a CEO has to take on faith.
 */

import { createClient } from "@/lib/supabase/client";
import type { ActivityKind } from "./activity-timeline";

/* The vocabulary and the timeline maths live in activity-timeline.ts (no
 * imports, so they are testable on their own); everything importing
 * "@/lib/activity" still gets them from here. */
export * from "./activity-timeline";


const HEARTBEAT_MS = 60_000;   // one row per minute of genuine activity
const IDLE_AFTER_MS = 120_000; // no input for this long = idle, stop counting

/** Fire-and-forget: activity logging must never break or slow the page. */
export async function logActivity(
  academyId: string,
  profileId: string,
  kind: ActivityKind,
  opts: { classroomId?: string; detail?: string; seconds?: number } = {},
) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http")) return;
  try {
    const supabase = createClient();
    await supabase.from("activity_events").insert({
      academy_id: academyId,
      profile_id: profileId,
      kind,
      classroom_id: opts.classroomId ?? null,
      detail: opts.detail?.slice(0, 300) ?? null,
      seconds: opts.seconds ?? null,
    });
  } catch {
    /* never surface logging failures to the user */
  }
}

/**
 * Start the heartbeat. Returns a stop function.
 *
 * Deliberately counts only whole windows that were genuinely active: the timer
 * checks whether real input happened since the last tick, and skips the write
 * entirely if not. That's what keeps an idle tab from inflating someone's hours.
 */
export function startActivityHeartbeat(academyId: string, profileId: string) {
  if (typeof window === "undefined") return () => {};

  let lastInput = Date.now();
  let idleLogged = false;
  let idleSince: number | null = null;

  const markInput = () => {
    const now = Date.now();
    // Coming back from idle: record how long they were away, then resume.
    if (idleSince !== null) {
      const away = Math.round((now - idleSince) / 1000);
      if (away > 0) void logActivity(academyId, profileId, "idle", { seconds: Math.min(away, 7200) });
      idleSince = null;
      idleLogged = false;
    }
    lastInput = now;
  };

  const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "scroll", "pointermove", "focus"];
  events.forEach((e) => window.addEventListener(e, markInput, { passive: true }));

  const timer = setInterval(() => {
    const now = Date.now();
    const quietFor = now - lastInput;
    const visible = document.visibilityState === "visible";

    if (quietFor > IDLE_AFTER_MS || !visible) {
      if (!idleLogged) { idleSince = lastInput + IDLE_AFTER_MS; idleLogged = true; }
      return; // no 'active' seconds while idle or hidden
    }
    void logActivity(academyId, profileId, "active", { seconds: Math.round(HEARTBEAT_MS / 1000) });
  }, HEARTBEAT_MS);

  return () => {
    clearInterval(timer);
    events.forEach((e) => window.removeEventListener(e, markInput));
  };
}
