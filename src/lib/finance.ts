/* Money maths for the CEO dashboard.
 *
 * Pure functions only - no React, no database - so they can be tested and used
 * on the server. The dashboard passes in whatever the database has; when that
 * is empty (a fresh install, or a demo machine) it falls back to DEMO_MONTHS so
 * the page always shows a working, believable picture instead of zeros. */

/** How each rupee of revenue is split. The platform has no payouts table yet,
 *  so these are the academy's agreed rates rather than recorded transfers. */
export const COACH_SHARE = 0.6;          // 60% goes to the instructor
export const GATEWAY_FEE_RATE = 0.025;   // 2.5% payment gateway
export const PLATFORM_FEE_RATE = 0.05;   // 5% platform service fee

export type MonthPoint = { month: string; revenue: number };

/** Twelve months of believable revenue for a mid-size academy, in rupees.
 *  Used whenever the invoices table has nothing in it. */
export const DEMO_MONTHS: MonthPoint[] = [
  { month: "Aug", revenue: 486_000 },
  { month: "Sep", revenue: 512_400 },
  { month: "Oct", revenue: 498_700 },
  { month: "Nov", revenue: 545_300 },
  { month: "Dec", revenue: 601_800 },
  { month: "Jan", revenue: 578_200 },
  { month: "Feb", revenue: 634_500 },
  { month: "Mar", revenue: 689_100 },
  { month: "Apr", revenue: 662_400 },
  { month: "May", revenue: 724_800 },
  { month: "Jun", revenue: 781_300 },
  { month: "Jul", revenue: 812_600 },
];

export type FinanceSummary = {
  months: MonthPoint[];
  totalRevenue: number;
  coachEarnings: number;
  platformDeductions: number;
  netProfit: number;
  /** Percent change of the last month against the one before it. */
  revenueChangePct: number;
  isDemo: boolean;
};

/** Percent change from `prev` to `next`. Returns 0 when there is no base. */
export function changePct(prev: number, next: number): number {
  if (!prev) return 0;
  return ((next - prev) / prev) * 100;
}

/** Build every number the dashboard shows. Pass the real months when there are
 *  any; pass an empty list (or nothing) to get the demo picture. */
export function financeSummary(months?: MonthPoint[] | null): FinanceSummary {
  const real = (months ?? []).filter((m) => m && Number.isFinite(m.revenue));
  const isDemo = real.length < 2;
  const series = isDemo ? DEMO_MONTHS : real;

  const totalRevenue = series.reduce((sum, m) => sum + m.revenue, 0);
  const coachEarnings = totalRevenue * COACH_SHARE;
  const platformDeductions = totalRevenue * (GATEWAY_FEE_RATE + PLATFORM_FEE_RATE);
  const netProfit = totalRevenue - coachEarnings - platformDeductions;

  const last = series.at(-1)?.revenue ?? 0;
  const prev = series.at(-2)?.revenue ?? 0;

  return {
    months: series,
    totalRevenue,
    coachEarnings,
    platformDeductions,
    netProfit,
    revenueChangePct: changePct(prev, last),
    isDemo,
  };
}

/* ── coach payment history ───────────────────────────────────────────────── */

/** What a coach is paid for running one session, in rupees. The academy's
 *  flat per-class rate; it is not derived from what the student paid. */
export const SESSION_RATE_INR = 300;

export type PaymentRow = {
  /** ISO timestamp of the session or the day the penalty was applied. */
  at: string;
  /** Class title, or the penalty's reason. */
  label: string;
  /** Positive for a taught session, 0 for a penalty line. */
  earned: number;
  /** Positive rupee amount withheld; 0 for a session line. */
  deducted: number;
  /** Present only on penalty lines, so the UI can offer an appeal. */
  penaltyId?: string;
  penaltyStatus?: string;
};

/** Build the coach's statement: one line per completed class, one per penalty,
 *  newest first.
 *
 *  A waived penalty is deliberately still listed, at zero, rather than dropped:
 *  a coach who successfully appealed should be able to see that it happened and
 *  that it cost them nothing, and a statement that silently loses rows is one
 *  nobody trusts. */
export function paymentRows(
  sessions: { id: string; title: string; scheduled_at: string }[],
  penalties: { id: string; amount: number; status: string; reason: string; created_at: string }[],
  rate = SESSION_RATE_INR,
): PaymentRow[] {
  const rows: PaymentRow[] = [
    ...sessions.map((s) => ({
      at: s.scheduled_at,
      label: s.title,
      earned: rate,
      deducted: 0,
    })),
    ...penalties.map((p) => ({
      at: p.created_at,
      label: p.reason,
      earned: 0,
      // An appeal that succeeded costs nothing; one still pending is withheld.
      deducted: p.status === "waived" ? 0 : Number(p.amount) || 0,
      penaltyId: p.id,
      penaltyStatus: p.status,
    })),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

/** Gross, withheld and take-home for a statement. */
export function paymentTotals(rows: PaymentRow[]): {
  sessions: number; gross: number; deductions: number; net: number;
} {
  const sessions = rows.filter((r) => r.earned > 0).length;
  const gross = rows.reduce((n, r) => n + r.earned, 0);
  const deductions = rows.reduce((n, r) => n + r.deducted, 0);
  return { sessions, gross, deductions, net: gross - deductions };
}

/* ── the live feed on the revenue chart ──────────────────────────────────── */

/** Cubic ease-out, 0..1. Fast at first, gentle at the end. */
export function easeOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

/** How many months at the tail move on each tick. Older months are settled. */
export const LIVE_TAIL = 3;

/** One reading of the feed: nudge only the newest months, by well under a
 *  percent, and never below zero. `rand` is injected so this is testable. */
export function nudge(values: number[], rand: () => number = Math.random): number[] {
  return values.map((v, i) =>
    i >= values.length - LIVE_TAIL ? Math.max(0, v * (1 + (rand() - 0.45) * 0.012)) : v,
  );
}

/** Where each value sits part-way through the ease. */
export function lerpAll(from: number[], to: number[], t: number): number[] {
  const k = easeOut(t);
  return from.map((v, i) => v + ((to[i] ?? v) - v) * k);
}

/** ₹12,45,000 - Indian grouping, no paise. */
export function inr(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

/** ₹8.1L / ₹1.2Cr - short form for the big number on a card. */
export function inrShort(amount: number): string {
  const n = Math.abs(Math.round(amount));
  const sign = amount < 0 ? "-" : "";
  if (n >= 10_000_000) return `${sign}₹${(n / 10_000_000).toFixed(2)}Cr`;
  if (n >= 100_000) return `${sign}₹${(n / 100_000).toFixed(2)}L`;
  if (n >= 1_000) return `${sign}₹${(n / 1_000).toFixed(1)}K`;
  return `${sign}₹${n}`;
}
