"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Megaphone, Bell, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui";
import { useProfile } from "@/lib/profile-context";
import type { Profile } from "@/lib/auth";

type Notification = { id: number; title: string; body: string | null; href: string | null; read_at: string | null };
type Announcement = { id: string; title: string; body: string; created_at: string };

/** Top bar - Announcements (megaphone) · Notifications (bell + badge) ·
 *  user menu (Profile / Payment History / Logout), per platform-sections.md. */
export function Topbar() {
  const { profile } = useProfile();
  const router = useRouter();
  const [open, setOpen] = useState<"none" | "announce" | "notif" | "user">("none");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [annTitle, setAnnTitle] = useState("");
  const [annBody, setAnnBody] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const isStaff = profile.role !== "student";

  useEffect(() => {
    const supabase = createClient();
    supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(20)
      .then(({ data }) => setNotifications(data ?? []));
    supabase.from("announcements").select("*").order("created_at", { ascending: false }).limit(10)
      .then(({ data }) => setAnnouncements(data ?? []));
  }, []);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen("none");
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const unread = notifications.filter((n) => !n.read_at).length;
  const base = `/${profile.role}/dashboard/${profile.academy_id}`;

  async function markAllRead() {
    const supabase = createClient();
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    setNotifications((n) => n.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
  }

  async function postAnnouncement() {
    if (!annTitle.trim()) return;
    const supabase = createClient();
    const { data, error } = await supabase.from("announcements").insert({
      academy_id: profile.academy_id, title: annTitle.trim(), body: annBody.trim(), created_by: profile.id,
    }).select("*").single();
    if (!error && data) {
      setAnnouncements((a) => [data as Announcement, ...a]);
      setAnnTitle(""); setAnnBody("");
    }
  }

  async function deleteAnnouncement(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("announcements").delete().eq("id", id);
    if (!error) setAnnouncements((a) => a.filter((x) => x.id !== id));
  }

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <header className="h-16 border-b border-border flex items-center justify-end gap-2 px-5 bg-surface-1 no-print" ref={wrapRef}>
      {/* Announcements */}
      <div className="relative">
        <button onClick={() => setOpen(open === "announce" ? "none" : "announce")}
          className="w-9 h-9 rounded-full transition-colors hover:bg-surface-3 flex items-center justify-center text-muted-foreground hover:text-foreground" title="Announcements"><Megaphone size={18} /></button>
        {open === "announce" && (
          <Dropdown title="Announcements">
            {isStaff && (
              <div className="px-4 py-3 border-b border-border flex flex-col gap-2">
                <input
                  className="bg-surface-2 border border-border rounded-btn px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Announcement title" value={annTitle}
                  onChange={(e) => setAnnTitle(e.target.value)}
                />
                <textarea
                  className="bg-surface-2 border border-border rounded-btn px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring min-h-14"
                  placeholder="Message…" value={annBody}
                  onChange={(e) => setAnnBody(e.target.value)}
                />
                <button
                  onClick={postAnnouncement}
                  disabled={!annTitle.trim()}
                  className="self-end bg-primary hover:bg-primary-hover text-white rounded-btn px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                >
                  Post
                </button>
              </div>
            )}
            {announcements.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No announcements yet.</p>}
            {announcements.map((a) => (
              <div key={a.id} className="px-4 py-3 border-b border-border last:border-0 group/ann relative">
                <p className="font-medium text-sm pr-6">{a.title}</p>
                <p className="text-sm text-muted-foreground">{a.body}</p>
                {isStaff && (
                  <button
                    title="Delete announcement"
                    onClick={() => deleteAnnouncement(a.id)}
                    className="absolute top-2.5 right-3 text-muted-foreground hover:text-destructive opacity-0 group-hover/ann:opacity-100"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </Dropdown>
        )}
      </div>

      {/* Notifications */}
      <div className="relative">
        <button onClick={() => setOpen(open === "notif" ? "none" : "notif")}
          className="relative w-9 h-9 rounded-full transition-colors hover:bg-surface-3 flex items-center justify-center text-muted-foreground hover:text-foreground" title="Notifications">
          <Bell size={18} />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-destructive text-white text-[10px] font-bold rounded-full min-w-4 h-4 px-1 flex items-center justify-center">
              {unread}
            </span>
          )}
        </button>
        {open === "notif" && (
          <Dropdown title="Notifications" action={unread > 0 ? { label: "Mark all read", onClick: markAllRead } : undefined}>
            {notifications.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">Nothing here yet.</p>}
            {notifications.map((n) => (
              <div key={n.id} className={`px-4 py-3 border-b border-border last:border-0 ${n.read_at ? "opacity-60" : ""}`}>
                <p className="font-medium text-sm">{n.title}</p>
                {n.body && <p className="text-sm text-muted-foreground">{n.body}</p>}
              </div>
            ))}
          </Dropdown>
        )}
      </div>

      {/* User menu */}
      <div className="relative">
        <button onClick={() => setOpen(open === "user" ? "none" : "user")}
          className="flex items-center gap-2 rounded-full border border-border bg-surface-2 hover:bg-surface-3 pl-1.5 pr-3 py-1.5 transition-colors">
          <Avatar name={profile.display_name} seed={profile.id} role={profile.role} size={28} avatar={profile.avatar} />
          <span className="text-sm font-medium hidden sm:block">{profile.display_name}</span>
        </button>
        {open === "user" && (
          <Dropdown>
            <div className="px-4 py-3 border-b border-border flex items-center gap-3">
              <Avatar name={profile.display_name} seed={profile.id} role={profile.role} size={36} avatar={profile.avatar} />
              <div>
                <p className="font-medium text-sm">{profile.display_name}</p>
                <p className="text-xs text-muted-foreground">{profile.username ?? profile.role}</p>
              </div>
            </div>
            <Link href={`${base}/profile`} className="block px-4 py-2.5 text-sm transition-colors hover:bg-surface-2" onClick={() => setOpen("none")}>Profile</Link>
            {/* Students have no payment section: fees are settled off-platform
                and their dashboard is only their classes. */}
            {profile.role !== "student" && (
              <Link href={`${base}/billing`} className="block px-4 py-2.5 text-sm transition-colors hover:bg-surface-2" onClick={() => setOpen("none")}>Payment History</Link>
            )}
            <button onClick={logout} className="block w-full text-left px-4 py-2.5 text-sm text-destructive transition-colors hover:bg-surface-2">Logout</button>
          </Dropdown>
        )}
      </div>
    </header>
  );
}

function Dropdown({ title, action, children }: {
  title?: string;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <div className="pop absolute right-0 top-full mt-1 z-40 bg-surface-1 border border-border rounded-card shadow-pop w-80 max-h-96 overflow-y-auto">
      {title && (
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <span className="font-medium text-sm">{title}</span>
          {action && (
            <button onClick={action.onClick} className="text-xs text-primary-hover hover:underline">{action.label}</button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
