"use client";

/* Live profile - the server renders the row once; anything that changes it
 * (the avatar builder, a name edit) calls `patch` and every consumer, topbar
 * included, updates on the spot. No refetch, no page reload. */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Profile } from "@/lib/auth";
import { startActivityHeartbeat, logActivity } from "@/lib/activity";

type Ctx = { profile: Profile; patch: (p: Partial<Profile>) => void };
const ProfileCtx = createContext<Ctx | null>(null);

export function ProfileProvider({ value, children }: { value: Profile; children: ReactNode }) {
  const [profile, setProfile] = useState(value);
  const patch = useCallback((p: Partial<Profile>) => setProfile((cur) => ({ ...cur, ...p })), []);

  /* Activity heartbeat lives here because every dashboard route is wrapped in
   * this provider - one place to start it, and it can't be forgotten on a new
   * page. It only counts time the user is genuinely interacting (see
   * lib/activity.ts); an idle or hidden tab accrues nothing. */
  useEffect(() => {
    void logActivity(value.academy_id, value.id, "login");
    const stop = startActivityHeartbeat(value.academy_id, value.id);
    return stop;
  }, [value.academy_id, value.id]);

  return <ProfileCtx.Provider value={{ profile, patch }}>{children}</ProfileCtx.Provider>;
}

/** Inside the dashboard this is always present; elsewhere it throws loudly. */
export function useProfile(): Ctx {
  const ctx = useContext(ProfileCtx);
  if (!ctx) throw new Error("useProfile must be used inside <ProfileProvider>");
  return ctx;
}
