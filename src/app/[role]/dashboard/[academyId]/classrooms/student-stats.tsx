"use client";

/* Student performance strip - shown above the class list on a student's
 * Classrooms page (their landing section). Purely additive: it reads the same
 * points_ledger the Leaderboard already aggregates, plus the student's own
 * profile, and never writes. Staff never see it.
 *
 * Metrics: XP (lifetime points), coins, rank within the academy, and quiz wins
 * (points_ledger rows with reason 'quiz' that scored positive). */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Award, Coins, Trophy, Target } from "lucide-react";
import type { Profile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import { StatCard } from "@/components/ui";

type LedgerRow = { student_id: string; points: number; coins: number; reason: string | null };

export function StudentStats({ me, base }: { me: Profile; base: string }) {
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http")) return;
    createClient()
      .from("points_ledger")
      .select("student_id, points, coins, reason")
      .then(({ data }) => setLedger((data as LedgerRow[]) ?? []));
  }, []);

  const stats = useMemo(() => {
    if (!ledger) return null;
    const byStudent = new Map<string, number>();
    let myPoints = 0;
    let myCoins = 0;
    let quizWins = 0;
    for (const r of ledger) {
      byStudent.set(r.student_id, (byStudent.get(r.student_id) ?? 0) + r.points);
      if (r.student_id === me.id) {
        myPoints += r.points;
        myCoins += r.coins;
        if (r.reason === "quiz" && r.points > 0) quizWins += 1;
      }
    }
    const totals = [...byStudent.entries()]
      .map(([id, points]) => ({ id, points }))
      .filter((s) => s.points > 0)
      .sort((a, b) => b.points - a.points);
    const rank = totals.findIndex((s) => s.id === me.id);
    return {
      points: Math.max(0, myPoints),
      coins: Math.max(0, myCoins),
      rank: rank >= 0 ? rank + 1 : null,
      field: totals.length,
      quizWins,
    };
  }, [ledger, me]);

  if (!stats) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Your progress</h2>
        <Link href={`${base}/leaderboard`} className="text-sm text-primary-hover hover:underline">
          View leaderboard →
        </Link>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="XP earned" value={stats.points} tint="violet" icon={<Award size={20} />} />
        <StatCard label="Coins" value={stats.coins} tint="amber" icon={<Coins size={20} />} />
        <StatCard
          label={stats.rank ? `Rank of ${stats.field}` : "Rank"}
          value={stats.rank ? `#${stats.rank}` : "—"}
          tint="mint"
          icon={<Trophy size={20} />}
        />
        <StatCard label="Quiz wins" value={stats.quizWins} tint="rose" icon={<Target size={20} />} />
      </div>
    </div>
  );
}
