"use client";

/* Shared UI kit - the reusable component inventory identified in
   Research Findings/Report/MASTER-REPORT.md §6: PageHeader, SegmentedTabs,
   FilterBar pieces, StatusPill, Avatar, Modal, EmptyState, Pagination.
   Styled to design-tokens.md (Inter, #372FC3, 10px btn radius, dark surfaces). */

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { AvatarArt, AVATAR_IDS, parseCustomAvatar } from "@/lib/avatars";
import { dicebearUrl, customAvatarUrl } from "@/lib/dicebear";
import { useProfile } from "@/lib/profile-context";

export function PageHeader({
  title, action,
}: { title: string; subtitle?: string; action?: ReactNode }) {
  // ponytail: `subtitle` is accepted but never rendered - headings only, the
  // explainer lines under every page title read as clutter.
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Button({
  children, variant = "primary", className = "", ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const styles = {
    primary: "bg-primary hover:bg-primary-hover text-primary-foreground shadow-primary",
    // On light, a secondary button is a RAISED white control (surface + hairline
    // + contact shadow), not a transparent outline - an outline-only button on a
    // near-white canvas reads as disabled.
    secondary: "border border-border bg-surface-2 hover:bg-surface-3 shadow-xs",
    danger: "bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/15",
    ghost: "bg-transparent hover:bg-surface-3",
  }[variant];
  return (
    <button
      // Press feedback is a scale, not a nudge, and it's on :active so it fires
      // on pointer-down - waiting for click to acknowledge a press feels dead.
      className={`inline-flex items-center justify-center gap-1.5 select-none rounded-btn px-4 py-2 text-base font-medium transition-[background-color,box-shadow,transform] duration-150 ease-out active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 ${styles} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return (
    <input
      className={`bg-surface-2 border border-border rounded-btn px-3 py-2 outline-none transition-[border-color,box-shadow] duration-150 hover:border-muted-foreground/40 focus:border-primary-hover/60 focus:ring-2 focus:ring-ring placeholder:text-muted-foreground ${className}`}
      {...rest}
    />
  );
}

/* Chevron drawn in-line so native pickers keep OS behavior but the closed
   control matches the reference (appearance-none + 16px lucide-style glyph). */
const CHEVRON =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>\")";

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", children, style, ...rest } = props;
  return (
    <select
      className={`appearance-none bg-surface-2 border border-border rounded-btn pl-3 pr-8 py-2 outline-none transition-[border-color,box-shadow] duration-150 hover:border-muted-foreground/40 focus:ring-2 focus:ring-ring cursor-pointer bg-no-repeat bg-[position:right_0.55rem_center] ${className}`}
      style={{ backgroundImage: CHEVRON, ...style }}
      {...rest}
    >
      {children}
    </select>
  );
}

export function SearchInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">⌕</span>
      <Input {...props} className={`pl-8 ${props.className ?? ""}`} />
    </div>
  );
}

/** Segmented toggle - Students/Batches, Current/Upcoming/…, Session/Series */
export function SegmentedTabs({
  tabs, active, onChange,
}: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    // Inset track (surface-3), raised thumb - the track has to be DARKER than
    // the thumb or the control disappears into a white card.
    <div className="inline-flex rounded-btn bg-surface-3 border border-border p-0.5 gap-0.5">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`px-4 py-1.5 rounded-[8px] text-sm font-medium transition-[background-color,color,box-shadow] duration-150 ease-out ${
            t === active
              ? "bg-primary text-white shadow-xs"
              : "text-muted-foreground hover:text-foreground hover:bg-surface-1"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

const PILL_COLORS: Record<string, string> = {
  active: "bg-success/15 text-success",
  present: "bg-success/15 text-success",
  completed: "bg-success/15 text-success",
  paid: "bg-success/15 text-success",
  done: "bg-success/15 text-success",
  approved: "bg-success/15 text-success",
  live: "bg-live/15 text-live",
  running: "bg-live/15 text-live",
  inactive: "bg-destructive/15 text-destructive",
  absent: "bg-destructive/15 text-destructive",
  overdue: "bg-destructive/15 text-destructive",
  cancelled: "bg-destructive/15 text-destructive",
  failed: "bg-destructive/15 text-destructive",
  rejected: "bg-destructive/15 text-destructive",
  due: "bg-warning/15 text-warning",
  late: "bg-warning/15 text-warning",
  delayed: "bg-warning/15 text-warning",
  needs_review: "bg-warning/15 text-warning",
  review: "bg-warning/15 text-warning",
};

export function StatusPill({ status }: { status: string }) {
  const color = PILL_COLORS[status.toLowerCase()] ?? "bg-surface-3 text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium capitalize whitespace-nowrap ${color}`}>
      <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-current opacity-70 shrink-0" />
      {status.replace(/_/g, " ")}
    </span>
  );
}

const AVATAR_BG = ["bg-live", "bg-primary-hover", "bg-success", "bg-warning", "bg-destructive"];

export function Avatar({
  name, size = 32, avatar, seed, role,
}: {
  name: string; size?: number; avatar?: string | null;
  /** Stable identity for the generated face - pass the profile id. Falls back
   *  to the name, which is stable too but shared between namesakes. */
  seed?: string;
  role?: string;
}) {
  // A DiceBear avatar the user configured themselves wins outright - this is
  // the deliberate choice made in Profile → Avatar.
  const chosen = avatar ? customAvatarUrl(avatar, Math.max(size, 96)) : null;
  if (chosen) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- inline data: URI
      <img src={chosen} alt={name} width={size} height={size}
        className="rounded-full shrink-0 bg-surface-3 object-cover"
        style={{ width: size, height: size }} />
    );
  }
  // Legacy hand-drawn avatar (some were bought with coins) - still honoured.
  if (avatar && (AVATAR_IDS.includes(avatar) || parseCustomAvatar(avatar))) {
    return <AvatarArt id={avatar} size={size} />;
  }
  // Everyone else gets a DiceBear face instead of the old initials chip, so
  // there are no blank/default profile icons left anywhere in the product.
  return (
    // eslint-disable-next-line @next/next/no-img-element -- inline data: URI, nothing for the image optimiser to fetch or resize
    <img
      src={dicebearUrl(seed || name, role, Math.max(size, 64))}
      alt={name}
      width={size}
      height={size}
      className="rounded-full shrink-0 bg-surface-3 object-cover"
      style={{ width: size, height: size }}
    />
  );
}

/** A person wherever they appear: face, name, and - for a CEO or manager - a
 *  link to their Full Report. Every list that shows a coach or student renders
 *  this instead of a bare <Avatar>, so "click anyone, anywhere" is one
 *  component rather than a link bolted onto each page (and a page that forgets
 *  to pass `avatar` no longer silently falls back to a generic face). */
export function Person({
  id, name, avatar, role, size = 24, showName = true, className = "",
}: {
  id?: string | null; name: string; avatar?: string | null; role?: string;
  size?: number; showName?: boolean; className?: string;
}) {
  const { profile } = useProfile();
  const inner = (
    <>
      <Avatar name={name} avatar={avatar} seed={id ?? undefined} role={role} size={size} />
      {showName && <span className="truncate">{name}</span>}
    </>
  );
  const body = <span className={`inline-flex items-center gap-2 min-w-0 ${className}`}>{inner}</span>;

  // Reports are a staff tool; a coach or student clicking a name gets nothing
  // new, so they keep the plain chip rather than a dead link.
  if (!id || (profile.role !== "ceo" && profile.role !== "manager")) return body;
  return (
    <Link href={`/${profile.role}/dashboard/${profile.academy_id}/people/${id}`}
      className={`inline-flex items-center gap-2 min-w-0 hover:underline ${className}`}
      title={`Full report: ${name}`}>
      {inner}
    </Link>
  );
}

export function Modal({
  open, onClose, title, children, wide, size,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; size?: "md" | "lg" | "xl" }) {
  // ponytail: `wide` kept as the existing alias for "lg"; `size` adds "xl" for
  // the two-pane immersive modals (Ask a Question) without touching any caller.
  const maxW = size === "xl" ? "max-w-5xl" : (size === "lg" || wide) ? "max-w-2xl" : "max-w-md";
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-scrim backdrop-blur-[3px] flex items-center justify-center p-4 no-print"
      onClick={onClose}
    >
      <div
        // surface-1, not surface-3: on light the modal must be the BRIGHTEST
        // thing on screen (white above a dimmed canvas). surface-3 is the
        // inset/hover tone and would make the panel read as sunken.
        className={`pop bg-surface-1 border border-border rounded-card p-6 w-full shadow-pop ${maxW} max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium tracking-tight">{title}</h2>
          <button onClick={onClose} aria-label="Close"
            className="w-7 h-7 -mr-1.5 rounded-btn flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground hover:bg-surface-3"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({
  text, action,
}: { text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center border border-dashed border-border rounded-card">
      <p className="text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}

export function Pagination({
  page, pageCount, onPage,
}: { page: number; pageCount: number; onPage: (p: number) => void }) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-1 mt-4 text-sm">
      <Button variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</Button>
      {Array.from({ length: pageCount }, (_, i) => i + 1).slice(0, 7).map((p) => (
        <button
          key={p}
          onClick={() => onPage(p)}
          className={`w-8 h-8 rounded-btn text-sm tabular-nums transition-colors ${p === page ? "bg-primary text-white" : "text-muted-foreground hover:bg-surface-3 hover:text-foreground"}`}
        >
          {p}
        </button>
      ))}
      <Button variant="ghost" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>›</Button>
    </div>
  );
}

/** Row overflow ⋮ menu used across tables/cards */
export function RowMenu({ items }: { items: { label: string; onClick: () => void; danger?: boolean }[] }) {
  return (
    <div className="relative group inline-block">
      <button aria-label="Row actions" className="w-8 h-8 rounded-btn transition-colors hover:bg-surface-3 text-muted-foreground hover:text-foreground">⋮</button>
      <div className="pop absolute right-0 top-full z-20 hidden group-focus-within:block group-hover:block bg-surface-1 border border-border rounded-card py-1 min-w-44 shadow-pop">
        {items.map((it) => (
          <button
            key={it.label}
            onClick={it.onClick}
            className={`block w-full text-left px-3.5 py-2 text-sm transition-colors hover:bg-surface-3 ${it.danger ? "text-destructive" : ""}`}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-surface-2 border border-border rounded-card p-5 shadow-card ${className}`}>
      {children}
    </div>
  );
}

const STAT_TINTS = {
  violet: "bg-[#efecfb] dark:bg-[#26234a]",
  mint: "bg-[#e3f5e9] dark:bg-[#1c3226]",
  amber: "bg-[#fbf1d9] dark:bg-[#3a2f14]",
  rose: "bg-[#fbe8ec] dark:bg-[#3a2029]",
} as const;

/** Pastel KPI tile - admin/manager dashboard overview rows. */
export function StatCard({
  label, value, tint = "violet", icon,
}: { label: string; value: string | number; tint?: keyof typeof STAT_TINTS; icon?: ReactNode }) {
  return (
    <div className={`rounded-card p-4 flex items-center justify-between gap-3 ${STAT_TINTS[tint]}`}>
      <div>
        <p className="text-2xl font-bold tracking-tight tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
      {icon && <span className="text-foreground/70">{icon}</span>}
    </div>
  );
}
