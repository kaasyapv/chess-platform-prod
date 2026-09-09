"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Moon, Sun } from "lucide-react";
import { canAccessSlug, NAV_ITEMS, APP_VERSION } from "@/lib/nav";
import type { Role } from "@/lib/auth";

/** Collapsible sidebar - lucide icon rail, version stamp, dark/light toggle.
 *  Collapses to icons, expands on hover; auto-collapses inside a classroom
 *  and on tablet-width viewports. */
export function Sidebar({ role, academyId, perms }: { role: Role; academyId: string; perms?: Record<string, boolean> | null }) {
  const pathname = usePathname();
  const inClassroom = /\/classrooms\/[0-9a-f-]{36}/.test(pathname);
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  // Suppresses hover-peek right after an explicit click, until the pointer
  // actually leaves the rail once - otherwise clicking "collapse" while your
  // cursor is still over the button (it always is) re-expands it instantly
  // via the hover-peek below, and the toggle looks broken.
  const [hoverArmed, setHoverArmed] = useState(true);
  // Light is the default (an unclassed :root), so dark is the opt-in state.
  const [dark, setDark] = useState(false);
  // Collapsed rail expands back out while hovered (Notion-style peek)
  const expanded = !collapsed || (hoverArmed && hovered);

  useEffect(() => {
    if (inClassroom) setCollapsed(true);
  }, [inClassroom]);

  // Tablet/laptop split: start collapsed under 1024px so the rail doesn't
  // eat a third of an iPad's width on first paint.
  useEffect(() => {
    if (window.innerWidth < 1024) setCollapsed(true);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("theme") === "dark";
    setDark(saved);
    document.documentElement.classList.toggle("dark", saved);
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  const base = `/${role}/dashboard/${academyId}`;

  return (
    /* Edge-to-edge dark rail - flush against the viewport, full height, the
       one dark anchor on a light page. It stays charcoal in dark mode too;
       only the workspace beside it changes. */
    <aside
      onMouseEnter={() => hoverArmed && setHovered(true)}
      onMouseLeave={() => { setHovered(false); setHoverArmed(true); }}
      className={`h-full bg-[#1b1c21] flex flex-col shrink-0 no-print transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
        expanded ? "w-60" : "w-[3.75rem]"
      }`}
    >
      <div className="flex items-center justify-between px-3 py-4">
        {expanded && <span className="font-bold text-lg tracking-tight px-1 whitespace-nowrap overflow-hidden text-white">ChessAcademy</span>}
        <button
          onClick={() => { setCollapsed((c) => !c); setHovered(false); setHoverArmed(false); }}
          className="w-8 h-8 rounded-btn transition-colors hover:bg-white/10 text-white/55 hover:text-white flex items-center justify-center"
          title={collapsed ? "Pin open" : "Collapse to icons"}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 flex flex-col gap-0.5">
        {NAV_ITEMS.filter((it) => canAccessSlug(role, it.slug, perms)).map((it, i) => {
          const href = `${base}/${it.slug}`;
          const active = pathname.startsWith(href);
          return (
            <div key={it.slug} className="contents">
            {it.divider && i > 0 && <span aria-hidden className="my-2 h-px bg-white/10" />}
            <Link
              href={href}
              title={it.label}
              className={`group flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-white text-[#1b1c21] shadow-sm"
                  : "text-white/55 hover:bg-white/10 hover:text-white"
              }`}
            >
              <it.icon size={18} strokeWidth={2} className="shrink-0" />
              {expanded && (
                <span className="flex-1 truncate whitespace-nowrap overflow-hidden">{it.label}</span>
              )}
            </Link>
            </div>
          );
        })}
      </nav>

      <div className="px-3 py-3 border-t border-white/10 flex items-center justify-between">
        <button
          onClick={toggleTheme}
          className="w-8 h-8 rounded-btn transition-colors hover:bg-white/10 flex items-center justify-center text-white/55 hover:text-white"
          title={dark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        {expanded && <span className="text-xs text-white/40">{APP_VERSION}</span>}
      </div>
    </aside>
  );
}
