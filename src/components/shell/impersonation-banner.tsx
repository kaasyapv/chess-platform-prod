"use client";

/* "Viewing as <student>" banner — shown in the dashboard shell while an admin
 * is impersonating a student (see /api/admin/impersonate).
 *
 * The impersonation session itself is a real magic-link login as the student;
 * this banner is the visible marker + the 15-minute working window + the Exit
 * that signs back out. The marker is a localStorage entry written by
 * `startImpersonation()` just before the new tab opens (localStorage is shared
 * across same-origin tabs; sessionStorage is not). It only renders for a
 * student session, so it can never appear over an admin's own tab. */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const KEY = "impersonation";
const WINDOW_MS = 15 * 60 * 1000;

type Mark = { student: string; by: string; at: number };

/** Call right before opening the impersonation URL in a new tab. */
export function startImpersonation(student: string, by: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ student, by, at: Date.now() } satisfies Mark));
  } catch { /* private mode - banner just won't show */ }
}

function readMark(): Mark | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Mark;
  } catch { return null; }
}

export function ImpersonationBanner({ role }: { role: string }) {
  const router = useRouter();
  const [mark] = useState<Mark | null>(() => (role === "student" ? readMark() : null));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Only a student session can be an impersonation; clear a stale mark on any
    // other role so a real student later on this browser never sees it.
    if (role !== "student") {
      try { localStorage.removeItem(KEY); } catch { /* */ }
      return;
    }
    if (!readMark()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [role]);

  if (!mark) return null;

  const left = mark.at + WINDOW_MS - now;
  const expired = left <= 0;
  const mins = Math.max(0, Math.floor(left / 60000));
  const secs = Math.max(0, Math.floor((left % 60000) / 1000));

  const exit = async () => {
    try { localStorage.removeItem(KEY); } catch { /* */ }
    await createClient().auth.signOut().catch(() => {});
    router.push("/login");
  };

  return (
    <div className={`flex items-center gap-3 px-4 py-1.5 text-xs font-medium text-white ${expired ? "bg-destructive" : "bg-warning"}`}>
      <span>
        {expired ? "Impersonation window ended" : `Viewing as ${mark.student}`}
        <span className="opacity-80"> · set by {mark.by}</span>
        {!expired && <span className="ml-2 tabular-nums opacity-80">{mins}:{String(secs).padStart(2, "0")} left</span>}
      </span>
      <span className="flex-1" />
      <button onClick={exit} className="rounded bg-white/20 px-2 py-0.5 hover:bg-white/30">Exit</button>
    </div>
  );
}
