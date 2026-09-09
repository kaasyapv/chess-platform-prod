/* Financial health cards for the CEO dashboard.
 *
 * Layout follows the reference: four cards on one row, the headline card filled
 * with the accent colour and the other three plain, each with a round arrow in
 * the corner, a big number, and one line saying how it moved. */

import Link from "next/link";
import { ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react";
import { inr, inrShort, type FinanceSummary } from "@/lib/finance";

type CardProps = {
  label: string;
  value: string;
  exact: string;
  note: string;
  good?: boolean;
  filled?: boolean;
  /** Pastel card background (reference language). Fixed colours with dark ink
      on purpose - the tinted cards read the same in light and dark mode. */
  tint?: string;
  href?: string;
};

function MetricCard({ label, value, exact, note, good = true, filled = false, tint = "#edebfa", href }: CardProps) {
  const Trend = good ? TrendingUp : TrendingDown;
  return (
    <div
      title={exact}
      style={filled ? undefined : { background: tint }}
      className={`relative rounded-card p-5 shadow-card transition-transform hover:-translate-y-0.5 ${
        filled ? "bg-[#1b1c21] text-white" : "text-[#26282e]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={`text-sm font-medium ${filled ? "text-white/70" : "text-[#26282e]/60"}`}>{label}</p>
        {href ? (
          <Link
            href={href}
            aria-label={`Open ${label}`}
            className={`shrink-0 w-7 h-7 rounded-full border flex items-center justify-center transition-colors ${
              filled ? "border-white/30 hover:bg-white/15" : "border-[#26282e]/20 hover:bg-white/50"
            }`}
          >
            <ArrowUpRight size={14} />
          </Link>
        ) : (
          <span
            aria-hidden
            className={`shrink-0 w-7 h-7 rounded-full border flex items-center justify-center ${
              filled ? "border-white/30" : "border-[#26282e]/20"
            }`}
          >
            <ArrowUpRight size={14} />
          </span>
        )}
      </div>

      <p className="mt-3 text-3xl font-bold tabular-nums tracking-tight">{value}</p>

      <p className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${
        filled ? "text-white/70" : good ? "text-[#067647]" : "text-[#d92d20]"
      }`}>
        <Trend size={14} className="shrink-0" />
        <span>{note}</span>
      </p>
    </div>
  );
}

export function FinancialCards({ summary, base, penaltiesTotal }: { summary: FinanceSummary; base: string; penaltiesTotal?: number }) {
  const {
    totalRevenue, netProfit, coachEarnings, platformDeductions, revenueChangePct, isDemo,
  } = summary;

  const pct = `${revenueChangePct >= 0 ? "+" : ""}${revenueChangePct.toFixed(1)}%`;
  const margin = totalRevenue ? (netProfit / totalRevenue) * 100 : 0;
  const coachPct = totalRevenue ? (coachEarnings / totalRevenue) * 100 : 0;
  const feePct = totalRevenue ? (platformDeductions / totalRevenue) * 100 : 0;

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="font-semibold">Financial health</h2>
          <p className="text-sm text-muted-foreground">Last twelve months across the whole academy.</p>
        </div>
        {isDemo && (
          <span
            title="No paid invoices yet, so these are example numbers."
            className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-medium text-warning"
          >
            Demo data
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          filled
          label="Total Revenue"
          value={inrShort(totalRevenue)}
          exact={inr(totalRevenue)}
          note={`${pct} from last month`}
          good={revenueChangePct >= 0}
          href={`${base}/billing`}
        />
        <MetricCard
          label="Net Profit"
          value={inrShort(netProfit)}
          exact={inr(netProfit)}
          note={`${margin.toFixed(1)}% margin kept`}
          good={netProfit >= 0}
          tint="#e2f2e7"
        />
        <MetricCard
          label="Coach Earnings"
          value={inrShort(coachEarnings)}
          exact={inr(coachEarnings)}
          note={`${coachPct.toFixed(0)}% paid to instructors`}
          tint="#edebfa"
        />
        <MetricCard
          label="Platform Deductions"
          value={inrShort(platformDeductions)}
          exact={inr(platformDeductions)}
          note={`${feePct.toFixed(1)}% fees and splits`}
          good={false}
          tint="#f8f0dc"
        />
        {typeof penaltiesTotal === "number" && penaltiesTotal > 0 && (
          <MetricCard
            label="Coach Penalties"
            value={inrShort(penaltiesTotal)}
            exact={inr(penaltiesTotal)}
            note="Active + under appeal"
            good={false}
            tint="#fbe4e4"
            href={`${base}/penalties`}
          />
        )}
      </div>
    </section>
  );
}
