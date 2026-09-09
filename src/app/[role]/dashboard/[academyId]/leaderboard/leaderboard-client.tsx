"use client";

/* Leaderboard - MASTER-REPORT §3 + §13: gamified; period selector (Daily…);
 * podium top-3 (gold/silver/bronze gradient cards, medals, crown on #1);
 * rankings list with points AND coins. Aggregated from points_ledger. */

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, EmptyState, PageHeader, SegmentedTabs } from "@/components/ui";

type Entry = { student_id: string; points: number; coins: number; created_at: string };
type Student = { id: string; display_name: string; username: string | null; avatar: string | null };

const PERIODS = ["Daily", "Weekly", "Monthly", "All-time"];

export function LeaderboardClient() {
  const [period, setPeriod] = useState("Weekly");
  const [ledger, setLedger] = useState<Entry[]>([]);
  const [students, setStudents] = useState<Student[]>([]);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http")) return;
    const supabase = createClient();
    supabase.from("points_ledger").select("student_id, points, coins, created_at")
      .then(({ data }) => setLedger(data ?? []));
    supabase.from("profiles").select("id, display_name, username, avatar").eq("role", "student")
      .then(({ data }) => setStudents(data ?? []));
  }, []);

  const ranking = useMemo(() => {
    const cutoff =
      period === "Daily" ? Date.now() - 86400_000 :
      period === "Weekly" ? Date.now() - 7 * 86400_000 :
      period === "Monthly" ? Date.now() - 30 * 86400_000 : 0;
    const sums = new Map<string, { points: number; coins: number }>();
    for (const e of ledger) {
      if (cutoff && new Date(e.created_at).getTime() < cutoff) continue;
      const cur = sums.get(e.student_id) ?? { points: 0, coins: 0 };
      cur.points += e.points;
      cur.coins += e.coins;
      sums.set(e.student_id, cur);
    }
    return students
      .map((s) => ({ ...s, ...(sums.get(s.id) ?? { points: 0, coins: 0 }) }))
      .filter((s) => s.points > 0 || s.coins > 0)
      .sort((a, b) => b.points - a.points || b.coins - a.coins);
  }, [ledger, students, period]);

  const podium = ranking.slice(0, 3);
  const rest = ranking.slice(3);
  const PODIUM_CLASS = ["podium-gold", "podium-silver", "podium-bronze"];
  const RANK_LABEL = ["1st", "2nd", "3rd"];

  return (
    <div>
      <PageHeader title="Leaderboard" subtitle="Points and coins earned across classes, homework and tournaments" />
      <div className="mb-6"><SegmentedTabs tabs={PERIODS} active={period} onChange={setPeriod} /></div>

      {ranking.length === 0 ? (
        <EmptyState text="No points awarded in this period yet. Points appear here as coaches review homework and run tournaments." />
      ) : (
        /* key={period} replays every entrance when the filter changes */
        <div key={period}>
          {/* Podium - silver, gold, bronze; gold rises last and highest */}
          <div className="flex items-end justify-center gap-4 mb-8 max-w-2xl mx-auto">
            {[1, 0, 2].map((idx, col) => {
              const p = podium[idx];
              if (!p) return <div key={idx} className="flex-1" />;
              return (
                <div
                  key={p.id}
                  className={`flex-1 rounded-card p-4 text-center text-black shadow-raised
                    transition-transform duration-300 hover:-translate-y-1.5 hover:shadow-xl
                    rise rise-${col + 1} ${PODIUM_CLASS[idx]} ${idx === 0 ? "pb-8 -translate-y-2" : ""}`}
                >
                  <div className="flex justify-center mb-2">
                    <span className="rounded-full ring-2 ring-black/25 inline-flex">
                      <Avatar name={p.display_name} avatar={p.avatar} seed={p.id} role="student" size={idx === 0 ? 52 : 44} />
                    </span>
                  </div>
                  <p className="font-bold truncate">{p.display_name}</p>
                  <p className="text-sm font-semibold uppercase tracking-wide opacity-80">{RANK_LABEL[idx]}</p>
                  <p className="font-semibold tabular-nums">{p.points} pts</p>
                  <p className="text-sm opacity-80 tabular-nums">{p.coins} coins</p>
                </div>
              );
            })}
          </div>

          {/* Rankings - each row slides in, its points bar grows to scale */}
          <div className="max-w-2xl mx-auto bg-surface-2 border border-border rounded-card overflow-hidden">
            {rest.map((s, i) => (
              <div
                key={s.id}
                className="rise flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-0 transition-colors hover:bg-surface-3/60"
                style={{ animationDelay: `${0.25 + i * 0.05}s` }}
              >
                <span className="w-8 text-muted-foreground tabular-nums font-semibold">#{i + 4}</span>
                <Avatar name={s.display_name} avatar={s.avatar} seed={s.id} role="student" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{s.display_name}</p>
                  <div className="h-1.5 mt-1 rounded-full bg-surface-3 overflow-hidden">
                    <div
                      className="grow-bar h-full rounded-full bg-gradient-to-r from-primary to-primary-hover"
                      style={{ width: `${Math.max(4, (s.points / (ranking[0]?.points || 1)) * 100)}%`, animationDelay: `${0.35 + i * 0.05}s` }}
                    />
                  </div>
                </div>
                <span className="font-semibold tabular-nums">{s.points} pts</span>
                <span className="text-sm text-muted-foreground tabular-nums w-16 text-right">{s.coins} coins</span>
              </div>
            ))}
            {rest.length === 0 && (
              <p className="px-4 py-3 text-sm text-muted-foreground text-center">Solve puzzles and win games to join the podium.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
