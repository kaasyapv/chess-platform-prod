import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile, dashboardPath } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, StatusPill } from "@/components/ui";
import { FinancialCards } from "@/components/dash/financial-cards";
import { RevenueChart } from "@/components/dash/revenue-chart";
import { financeSummary, inr } from "@/lib/finance";
import { checkEnv } from "@/lib/env";

/** Organization Dashboard - the CEO's operational command center
 *  (ARCHITECTURE_V2.md §7). Replaces the CEO's standalone Billing entry;
 *  students keep their Payment History page untouched. */
export default async function OrganizationPage({
  params,
}: { params: Promise<{ role: string; academyId: string }> }) {
  const { role, academyId } = await params;
  const profile = await requireProfile(role, academyId);
  if (profile.role !== "ceo") redirect(dashboardPath(profile));

  const supabase = await createClient();
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const yearStart = new Date();
  yearStart.setMonth(yearStart.getMonth() - 11); yearStart.setDate(1); yearStart.setHours(0, 0, 0, 0);

  const [students, coaches, managers, leads, live, upcoming, paidMonth, subs, jobs, secret, audit, paidYear, penalties, failures] =
    await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student").eq("status", "active"),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "coach"),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "manager"),
      supabase.from("leads").select("status"),
      supabase.from("classrooms").select("id, title, coach:profiles!classrooms_coach_id_fkey(display_name)").eq("status", "live"),
      supabase.from("classrooms").select("id, title, scheduled_at").eq("status", "scheduled")
        .gte("scheduled_at", new Date().toISOString()).lte("scheduled_at", todayEnd.toISOString())
        .order("scheduled_at").limit(6),
      supabase.from("invoices").select("amount_inr").eq("status", "paid").gte("paid_at", monthStart.toISOString()),
      supabase.from("subscriptions").select("amount_inr, billing_interval").eq("status", "active"),
      supabase.from("extraction_jobs").select("id", { count: "exact", head: true }),
      supabase.from("academy_secrets").select("webhook_token").eq("academy_id", academyId).single(),
      supabase.from("audit_log").select("table_name, action, created_at").order("created_at", { ascending: false }).limit(15),
      supabase.from("invoices").select("amount_inr, paid_at").eq("status", "paid")
        .gte("paid_at", yearStart.toISOString()).order("paid_at"),
      supabase.from("coach_penalties").select("amount, status").neq("status", "waived"),
      supabase.from("failure_events").select("dispatch_status")
        .gte("created_at", new Date(Date.now() - 30 * 864e5).toISOString()),
    ]);

  const leadRows = leads.data ?? [];
  const pipeline = ["new", "qualified", "assigned", "demo", "trial", "enrolled"].map((s) => ({
    stage: s, n: leadRows.filter((l) => l.status === s).length,
  }));
  const openLeads = leadRows.filter((l) => !["enrolled", "lost"].includes(l.status)).length;
  const revenueMonth = (paidMonth.data ?? []).reduce((n, i) => n + Number(i.amount_inr), 0);
  const mrr = (subs.data ?? []).reduce((n, s) => {
    const m = s.billing_interval === "monthly" ? 1 : s.billing_interval === "quarterly" ? 3 : 12;
    return n + Number(s.amount_inr) / m;
  }, 0);

  /* Twelve months of paid invoices, oldest first. When the table is empty (a
   * fresh install, or the demo machine) financeSummary swaps in demo numbers so
   * the dashboard still shows a working picture instead of a row of zeros. */
  const byMonth = new Map<string, number>();
  for (const row of paidYear.data ?? []) {
    if (!row.paid_at) continue;
    const d = new Date(row.paid_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + Number(row.amount_inr ?? 0));
  }
  const realMonths = [...byMonth.entries()].map(([key, revenue]) => {
    const [y, m] = key.split("-").map(Number);
    return { month: new Date(y, m, 1).toLocaleString("en-US", { month: "short" }), revenue };
  });
  const finance = financeSummary(realMonths);
  const penaltiesTotal = (penalties.data ?? []).reduce((n, p) => n + Number(p.amount), 0);

  const fRows = failures.data ?? [];
  const failureStats = {
    total: fRows.length,
    sent: fRows.filter((f) => f.dispatch_status === "sent").length,
    duplicate: fRows.filter((f) => f.dispatch_status === "duplicate").length,
    failed: fRows.filter((f) => f.dispatch_status === "failed").length,
    notConfigured: fRows.filter((f) => f.dispatch_status === "not_configured").length,
  };
  const n8nReady = Boolean(process.env.N8N_FALLBACK_WEBHOOK_URL);

  const env = checkEnv();
  const razorpayReady = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
  const billingProvider = process.env.BILLING_PROVIDER || "mock";
  const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

  const stats = [
    { label: "Active students", value: students.count ?? 0 },
    { label: "Coaches", value: coaches.count ?? 0 },
    { label: "Managers", value: managers.count ?? 0 },
    { label: "Open leads", value: openLeads },
    { label: "Revenue (month)", value: inr(revenueMonth) },
    { label: "Subscription MRR", value: inr(mrr) },
  ];

  return (
    <div>
      <PageHeader
        title="Organization"
        subtitle="Executive command center: operations, growth, revenue and platform health"
        action={
          // A file download, not a page: <Link> would soft-navigate and never
          // hand the browser the spreadsheet.
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a
            href="/api/export/finance"
            className="inline-flex items-center justify-center gap-1.5 rounded-btn px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover text-primary-foreground shadow-primary transition-colors"
          >
            Download Excel
          </a>
        }
      />

      <FinancialCards summary={finance} base={`/${role}/dashboard/${academyId}`} penaltiesTotal={penaltiesTotal} />

      <section className="mb-6 rounded-card border border-border bg-surface-2 p-5">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <h2 className="font-semibold">Revenue over time</h2>
            <p className="text-sm text-muted-foreground">
              Money collected each month. The newest month keeps updating as payments land.
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xl font-bold tabular-nums">{inr(finance.months.at(-1)?.revenue ?? 0)}</p>
            <p className="text-xs text-muted-foreground">this month</p>
          </div>
        </div>
        <RevenueChart months={finance.months} />
      </section>

      {/* Fallback dispatch health. n8n moved off lead acquisition (TeleCRM owns
          that) onto the failure path, so what matters here is whether broken
          classes are actually reaching parents. */}
      <div className="mb-6">
        <Card>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold">Failure fallback</h2>
              <p className="text-sm text-muted-foreground">
                When a live class breaks, the fallback meeting link is dispatched to the
                parent/student via n8n → WhatsApp.
              </p>
            </div>
            <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium border ${
              n8nReady
                ? "border-success/40 bg-success/10 text-success"
                : "border-warning/40 bg-warning/10 text-warning"
            }`}>
              {n8nReady ? "n8n webhook configured" : "N8N_FALLBACK_WEBHOOK_URL not set"}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
            {[
              { label: "Failures (30d)", value: failureStats.total },
              { label: "Links delivered", value: failureStats.sent },
              { label: "Duplicates suppressed", value: failureStats.duplicate },
              { label: "Needs attention", value: failureStats.failed + failureStats.notConfigured },
            ].map((s) => (
              <div key={s.label}>
                <p className="text-2xl font-bold tabular-nums">{s.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        {stats.map((s) => (
          <Card key={s.label}>
            <p className="text-2xl font-bold tabular-nums">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Live now</h2>
            <Link href={`/${role}/dashboard/${academyId}/live-ops`} className="text-sm text-primary-hover hover:underline">
              Live Ops wall →
            </Link>
          </div>
          {(live.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No classes in session.</p>
          ) : (
            <ul className="text-sm space-y-2">
              {(live.data ?? []).map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <StatusPill status="live" />
                  <span className="flex-1 truncate">{c.title}</span>
                  <span className="text-muted-foreground">{(c.coach as unknown as { display_name: string })?.display_name}</span>
                </li>
              ))}
            </ul>
          )}
          <h3 className="font-medium text-sm mt-4 mb-2 text-muted-foreground">Upcoming today</h3>
          {(upcoming.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing else scheduled today.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {(upcoming.data ?? []).map((c) => (
                <li key={c.id} className="flex justify-between gap-2">
                  <span className="truncate">{c.title}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {new Date(c.scheduled_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Lead pipeline</h2>
            <Link href={`/${role}/dashboard/${academyId}/leads`} className="text-sm text-primary-hover hover:underline">
              Open CRM →
            </Link>
          </div>
          <div className="flex gap-1.5">
            {pipeline.map((p) => (
              <div key={p.stage} className="flex-1 text-center">
                <div className="bg-primary/15 border border-primary/30 rounded-btn py-2 text-lg font-bold tabular-nums">{p.n}</div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{p.stage}</p>
              </div>
            ))}
          </div>
          <h3 className="font-medium text-sm mt-5 mb-2 text-muted-foreground">Integrations & platform health</h3>
          <ul className="text-sm space-y-1.5">
            <li className="flex justify-between">
              <span>Billing provider</span>
              <span className="font-medium capitalize">{billingProvider}{billingProvider === "razorpay" && !razorpayReady ? " (keys missing!)" : ""}</span>
            </li>
            <li className="flex justify-between">
              <span>Razorpay keys</span>
              <span className={razorpayReady ? "text-success" : "text-muted-foreground"}>{razorpayReady ? "Configured" : "not set"}</span>
            </li>
            <li className="flex justify-between">
              <span>AI provider key</span>
              <span className={Object.keys(env.disabled).length === 0 ? "text-success" : "text-warning"}>
                {Object.keys(env.disabled).length === 0 ? "Configured" : "Missing (extraction disabled)"}
              </span>
            </li>
            <li className="flex justify-between">
              <span>AI extraction jobs (all time)</span>
              <span className="tabular-nums">{jobs.count ?? 0}</span>
            </li>
          </ul>
        </Card>
      </div>

      <Card className="mb-6">
        <h2 className="font-semibold mb-2">Lead ingestion webhook (n8n)</h2>
        <p className="text-sm text-muted-foreground mb-2">
          Point Meta Ads / Google Forms / WhatsApp / Calendly workflows at this endpoint with the
          token header, payload spec in <code className="text-xs">docs/ARCHITECTURE_V2.md §4</code>.
        </p>
        {secret.data ? (
          <pre className="bg-surface-3 border border-border rounded-btn p-3 text-xs font-mono overflow-x-auto">
{`POST ${process.env.NEXT_PUBLIC_SITE_URL ?? "https://<your-domain>"}/api/webhooks/leads
x-academy-token: ${secret.data.webhook_token}`}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">Token unavailable, apply migration 0006.</p>
        )}
      </Card>

      <h2 className="text-lg font-medium mb-3">Recent activity</h2>
      {(audit.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No audit entries yet.</p>
      ) : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {(audit.data ?? []).map((a, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 text-muted-foreground">{new Date(a.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2">{a.table_name}</td>
                  <td className="px-4 py-2"><StatusPill status={a.action.toLowerCase()} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
