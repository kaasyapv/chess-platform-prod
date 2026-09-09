"use client";

/* External game tracking (ChessPlay demo §13:00): enter a Chess.com or
 * Lichess username → live ratings/stats + recent games, each loadable into
 * the Analysis board. Both public APIs support CORS - no server route. */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Select } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

type Stat = { label: string; rating: number | string; games?: number };
type GameRow = { white: string; black: string; result: string; speed: string; at: number; pgn: string };

export function ExternalTracker({ role, academyId }: { role: string; academyId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [platform, setPlatform] = useState("chess.com");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<Stat[] | null>(null);
  const [games, setGames] = useState<GameRow[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("external-tracker");
    if (saved) {
      const { platform: p, username: u } = JSON.parse(saved);
      if (p) setPlatform(p);
      if (u) setUsername(u);
    }
  }, []);

  async function fetchChessCom(u: string) {
    const sRes = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(u)}/stats`);
    if (!sRes.ok) throw new Error(sRes.status === 404 ? "User not found on Chess.com" : `Chess.com API ${sRes.status}`);
    const s = await sRes.json();
    const pick = (k: string, label: string): Stat | null => {
      const v = s[k];
      if (!v?.last) return null;
      const rec = v.record ? v.record.win + v.record.loss + v.record.draw : undefined;
      return { label, rating: v.last.rating, games: rec };
    };
    setStats([pick("chess_rapid", "Rapid"), pick("chess_blitz", "Blitz"), pick("chess_bullet", "Bullet"), pick("chess_daily", "Daily")]
      .filter(Boolean) as Stat[]);

    const aRes = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(u)}/games/archives`);
    const { archives } = await aRes.json();
    if (!archives?.length) { setGames([]); return; }
    const g = await (await fetch(archives[archives.length - 1])).json();
    type CGame = { pgn?: string; white: { username: string; result: string }; black: { username: string; result: string }; time_class: string; end_time: number };
    setGames(((g.games ?? []) as CGame[]).slice(-10).reverse().map((gm) => ({
      white: gm.white.username, black: gm.black.username,
      result: gm.white.result === "win" ? "1-0" : gm.black.result === "win" ? "0-1" : "½-½",
      speed: gm.time_class, at: gm.end_time * 1000, pgn: gm.pgn ?? "",
    })).filter((gm) => gm.pgn));
  }

  async function fetchLichess(u: string) {
    const uRes = await fetch(`https://lichess.org/api/user/${encodeURIComponent(u)}`);
    if (!uRes.ok) throw new Error(uRes.status === 404 ? "User not found on Lichess" : `Lichess API ${uRes.status}`);
    const user = await uRes.json();
    const perfs = user.perfs ?? {};
    setStats((["rapid", "blitz", "bullet", "classical"] as const)
      .filter((k) => perfs[k]?.games > 0)
      .map((k) => ({ label: k[0].toUpperCase() + k.slice(1), rating: perfs[k].rating, games: perfs[k].games })));

    const gRes = await fetch(
      `https://lichess.org/api/games/user/${encodeURIComponent(u)}?max=10&pgnInJson=true&perfType=bullet,blitz,rapid,classical`,
      { headers: { Accept: "application/x-ndjson" } },
    );
    const text = await gRes.text();
    type LGame = { pgn?: string; speed: string; createdAt: number; status: string; winner?: string; players: { white?: { user?: { name: string } }; black?: { user?: { name: string } } } };
    setGames(text.trim().split("\n").filter(Boolean).map((line) => {
      const gm = JSON.parse(line) as LGame;
      return {
        white: gm.players.white?.user?.name ?? "Anonymous",
        black: gm.players.black?.user?.name ?? "Anonymous",
        result: gm.winner === "white" ? "1-0" : gm.winner === "black" ? "0-1" : "½-½",
        speed: gm.speed, at: gm.createdAt, pgn: gm.pgn ?? "",
      };
    }).filter((gm) => gm.pgn));
  }

  async function track() {
    const u = username.trim();
    if (!u) return;
    setBusy(true);
    setStats(null);
    setGames([]);
    try {
      if (platform === "chess.com") await fetchChessCom(u);
      else await fetchLichess(u);
      localStorage.setItem("external-tracker", JSON.stringify({ platform, username: u }));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Fetch failed", "error");
    } finally {
      setBusy(false);
    }
  }

  function analyze(pgn: string) {
    sessionStorage.setItem("analysis-import-pgn", pgn);
    router.push(`/${role}/dashboard/${academyId}/analysis-board`);
  }

  return (
    <Card className="mt-6">
      <h2 className="font-semibold mb-1">External game tracking</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Track Chess.com / Lichess ratings and analyze recent games here.
      </p>
      <form className="flex flex-wrap gap-2 mb-4" onSubmit={(e) => { e.preventDefault(); void track(); }}>
        <Select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="chess.com">Chess.com</option>
          <option value="lichess">Lichess</option>
        </Select>
        <Input className="flex-1 min-w-40" placeholder="Username" value={username}
          onChange={(e) => setUsername(e.target.value)} />
        <Button type="submit" disabled={busy || !username.trim()}>{busy ? "Fetching…" : "Track stats"}</Button>
      </form>

      {stats && (
        stats.length === 0 ? <p className="text-sm text-muted-foreground">No rated games found.</p> : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {stats.map((s) => (
              <div key={s.label} className="bg-surface-3 rounded-card p-3 text-center">
                <p className="text-xl font-bold tabular-nums">{s.rating}</p>
                <p className="text-xs text-muted-foreground">{s.label}{s.games != null ? ` · ${s.games} games` : ""}</p>
              </div>
            ))}
          </div>
        )
      )}

      {games.length > 0 && (
        <div className="border border-border rounded-card overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {games.map((g, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{g.white} vs {g.black}</td>
                  <td className="px-3 py-2 tabular-nums">{g.result}</td>
                  <td className="px-3 py-2 text-muted-foreground capitalize">{g.speed}</td>
                  <td className="px-3 py-2 text-muted-foreground">{new Date(g.at).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-right">
                    <Button variant="ghost" onClick={() => analyze(g.pgn)}>Analyze game</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
