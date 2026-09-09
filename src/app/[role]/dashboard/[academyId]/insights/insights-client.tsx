"use client";

/* Game Insights - type any chess.com or Lichess username and study their
 * recent games: win rates, colours, openings, and one click into the analysis
 * board (with engine) for any game. Both sites expose public CORS-friendly
 * APIs, so this runs entirely in the browser - no keys, no server. */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ExternalLink } from "lucide-react";
import { pgnTag } from "@/lib/pgn";
import { Button, Card, EmptyState, Input, PageHeader, SegmentedTabs } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

type Game = {
  id: string;
  site: "lichess" | "chess.com";
  white: string; black: string;
  myColor: "white" | "black";
  myResult: "win" | "loss" | "draw";
  opening: string;
  timeClass: string;
  endedAt: number;
  moves: number;
  pgn: string;
  url?: string;
};

const norm = (s: string) => s.trim().toLowerCase();

async function fetchLichess(user: string): Promise<Game[]> {
  const res = await fetch(
    `https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=30&opening=true&pgnInJson=true&clocks=false&evals=false`,
    { headers: { Accept: "application/x-ndjson" } },
  );
  if (res.status === 404) throw new Error("No such Lichess user");
  if (!res.ok) throw new Error(`Lichess said ${res.status}`);
  const text = await res.text();
  return text.split("\n").filter(Boolean).map((line) => {
    const g = JSON.parse(line);
    const whiteName = g.players?.white?.user?.name ?? "Anonymous";
    const blackName = g.players?.black?.user?.name ?? "Anonymous";
    const myColor: "white" | "black" = norm(whiteName) === norm(user) ? "white" : "black";
    const myResult: Game["myResult"] = !g.winner ? "draw" : g.winner === myColor ? "win" : "loss";
    return {
      id: g.id, site: "lichess" as const,
      white: whiteName, black: blackName, myColor, myResult,
      opening: g.opening?.name ?? "",
      timeClass: g.speed ?? "",
      endedAt: g.lastMoveAt ?? g.createdAt ?? 0,
      moves: g.moves ? g.moves.split(" ").length : 0,
      pgn: g.pgn ?? "",
      url: `https://lichess.org/${g.id}`,
    };
  });
}

async function fetchChessCom(user: string): Promise<Game[]> {
  const arch = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`);
  if (arch.status === 404) throw new Error("No such chess.com user");
  if (!arch.ok) throw new Error(`chess.com said ${arch.status}`);
  const { archives } = await arch.json() as { archives: string[] };
  if (!archives?.length) return [];
  // Newest months first until we have 30 games (2 fetches at most, usually 1).
  const games: Game[] = [];
  for (const url of archives.slice(-2).reverse()) {
    const res = await fetch(url);
    if (!res.ok) continue;
    const month = await res.json() as { games: Record<string, unknown>[] };
    for (const raw of (month.games ?? []).reverse()) {
      const g = raw as {
        uuid?: string; url?: string; pgn?: string; end_time?: number; time_class?: string;
        white: { username: string; result: string }; black: { username: string; result: string };
      };
      const myColor: "white" | "black" = norm(g.white.username) === norm(user) ? "white" : "black";
      const mine = myColor === "white" ? g.white : g.black;
      const myResult: Game["myResult"] =
        mine.result === "win" ? "win"
          : ["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"].includes(mine.result) ? "draw"
          : "loss";
      const pgn = g.pgn ?? "";
      games.push({
        id: g.uuid ?? g.url ?? String(g.end_time), site: "chess.com",
        white: g.white.username, black: g.black.username, myColor, myResult,
        opening: pgnTag(pgn, "ECOUrl")?.split("/openings/")[1]?.replace(/-/g, " ").slice(0, 60)
          ?? pgnTag(pgn, "ECO") ?? "",
        timeClass: g.time_class ?? "",
        endedAt: (g.end_time ?? 0) * 1000,
        moves: (pgn.match(/\d+\./g) ?? []).length,
        pgn,
        url: g.url,
      });
      if (games.length >= 30) return games;
    }
  }
  return games;
}

export function InsightsClient({ base }: { base: string }) {
  const router = useRouter();
  const toast = useToast();
  const [site, setSite] = useState("Lichess");
  const [username, setUsername] = useState("");
  const [games, setGames] = useState<Game[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [queried, setQueried] = useState("");

  async function run() {
    const u = username.trim();
    if (!u) return;
    setBusy(true);
    try {
      const list = site === "Lichess" ? await fetchLichess(u) : await fetchChessCom(u);
      setGames(list);
      setQueried(u);
      if (list.length === 0) toast("No recent games found for that account", "info");
    } catch (e) {
      setGames(null);
      toast(e instanceof Error ? e.message : "Could not fetch games", "error");
    } finally {
      setBusy(false);
    }
  }

  function analyze(g: Game) {
    if (!g.pgn) { toast("This game has no PGN to analyze", "error"); return; }
    sessionStorage.setItem("analysis-import-pgn", g.pgn);
    router.push(`${base}/analysis-board`);
  }

  const stats = useMemo(() => {
    if (!games?.length) return null;
    const n = games.length;
    const w = games.filter((g) => g.myResult === "win").length;
    const d = games.filter((g) => g.myResult === "draw").length;
    const l = n - w - d;
    const asWhite = games.filter((g) => g.myColor === "white");
    const asBlack = games.filter((g) => g.myColor === "black");
    const rate = (list: Game[]) => list.length
      ? Math.round((list.filter((g) => g.myResult === "win").length / list.length) * 100) : 0;
    const openings = new Map<string, { n: number; w: number }>();
    for (const g of games) {
      const key = g.opening.split(":")[0].trim();
      const o = openings.get(key) ?? { n: 0, w: 0 };
      o.n += 1; if (g.myResult === "win") o.w += 1;
      openings.set(key, o);
    }
    const topOpenings = [...openings.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 5);
    return { n, w, d, l, whiteRate: rate(asWhite), blackRate: rate(asBlack), topOpenings };
  }, [games]);

  return (
    <div>
      <PageHeader title="Game Insights" />

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <SegmentedTabs tabs={["Lichess", "Chess.com"]} active={site} onChange={setSite} />
        <div className="relative flex-1 min-w-64 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-full pl-9"
            placeholder={site === "Lichess" ? "Lichess username…" : "chess.com username…"}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
          />
        </div>
        <Button onClick={run} disabled={busy || !username.trim()}>
          {busy ? "Fetching…" : "Analyze games"}
        </Button>
      </div>

      {games === null && !busy && (
        <EmptyState text="Enter a student's Lichess or chess.com username to break down their recent games." />
      )}

      {busy && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4" aria-hidden>
          {[0, 1, 2].map((i) => <div key={i} className="h-28 rounded-card bg-surface-2 animate-pulse" />)}
        </div>
      )}

      {stats && games && !busy && (
        <>
          {/* Scoreline */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <p className="text-3xl font-bold tabular-nums">{stats.w}-{stats.l}-{stats.d}</p>
              <p className="text-xs text-muted-foreground mt-1">W-L-D over {stats.n} games ({queried})</p>
            </Card>
            <Card>
              <p className="text-3xl font-bold tabular-nums">{Math.round((stats.w / stats.n) * 100)}%</p>
              <p className="text-xs text-muted-foreground mt-1">Overall win rate</p>
            </Card>
            <Card>
              <p className="text-3xl font-bold tabular-nums">{stats.whiteRate}%</p>
              <p className="text-xs text-muted-foreground mt-1">Win rate as White</p>
            </Card>
            <Card>
              <p className="text-3xl font-bold tabular-nums">{stats.blackRate}%</p>
              <p className="text-xs text-muted-foreground mt-1">Win rate as Black</p>
            </Card>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Openings */}
            <Card>
              <h2 className="font-semibold mb-3">Most played openings</h2>
              <div className="flex flex-col gap-2">
                {stats.topOpenings.map(([name, o]) => (
                  <div key={name} className="text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="truncate">{name}</span>
                      <span className="text-muted-foreground tabular-nums shrink-0">{o.w}/{o.n} won</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-3 mt-1 overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${(o.w / o.n) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Game list */}
            <Card className="lg:col-span-2 p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="px-4 py-2.5 font-medium">Game</th>
                    <th className="px-4 py-2.5 font-medium">Result</th>
                    <th className="px-4 py-2.5 font-medium hidden md:table-cell">Opening</th>
                    <th className="px-4 py-2.5 font-medium hidden sm:table-cell">Speed</th>
                    <th className="px-4 py-2.5 font-medium text-right">Study</th>
                  </tr>
                </thead>
                <tbody>
                  {games.map((g) => (
                    <tr key={g.id} className="border-b border-border last:border-0 hover:bg-surface-3/50">
                      <td className="px-4 py-2.5">
                        <span className={g.myColor === "white" ? "font-semibold" : ""}>{g.white}</span>
                        <span className="text-muted-foreground"> vs </span>
                        <span className={g.myColor === "black" ? "font-semibold" : ""}>{g.black}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`font-semibold ${
                          g.myResult === "win" ? "text-success" : g.myResult === "loss" ? "text-destructive" : "text-muted-foreground"
                        }`}>
                          {g.myResult === "win" ? "Won" : g.myResult === "loss" ? "Lost" : "Draw"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground max-w-48 truncate hidden md:table-cell capitalize">{g.opening}</td>
                      <td className="px-4 py-2.5 text-muted-foreground capitalize hidden sm:table-cell">{g.timeClass}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <Button variant="secondary" className="!py-1 !px-2.5 text-xs" onClick={() => analyze(g)}>
                          Deep analysis
                        </Button>
                        {g.url && (
                          <a href={g.url} target="_blank" rel="noreferrer" title={`Open on ${g.site}`}
                            className="inline-flex ml-2 text-muted-foreground hover:text-foreground align-middle">
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
