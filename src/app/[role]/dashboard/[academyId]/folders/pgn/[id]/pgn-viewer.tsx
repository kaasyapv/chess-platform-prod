"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Chess } from "chess.js";
import { createClient } from "@/lib/supabase/client";
import { ChessBoard } from "@/components/board/chess-board";
import { PageHeader, Button, EmptyState, Card } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

type PgnRow = { id: string; title: string; content: string; created_at: string };

type Parsed = {
  fens: string[]; // fens[i] = position after i moves (fens[0] = start)
  moves: { san: string; from: string; to: string }[];
  headers: Record<string, string>;
  error?: string;
};

function parsePgn(content: string): Parsed {
  try {
    const chess = new Chess();
    chess.loadPgn(content.replace(/\r\n/g, "\n"));
    const headers = chess.getHeaders();
    const verbose = chess.history({ verbose: true });
    const startFen = headers.FEN ?? new Chess().fen();
    const replay = new Chess(startFen);
    const fens = [startFen];
    const moves = verbose.map((m) => {
      replay.move(m.san);
      fens.push(replay.fen());
      return { san: m.san, from: m.from, to: m.to };
    });
    return { fens, moves, headers };
  } catch (e) {
    return {
      fens: [new Chess().fen()],
      moves: [],
      headers: {},
      error: e instanceof Error ? e.message : "Could not parse PGN",
    };
  }
}

export function PgnViewer({
  academyId,
  role,
  pgnId,
}: {
  academyId: string;
  role: string;
  pgnId: string;
}) {
  const supabase = createClient();
  const toast = useToast();
  const [pgn, setPgn] = useState<PgnRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    supabase
      .from("pgns")
      .select("id, title, content, created_at")
      .eq("id", pgnId)
      .single()
      .then(({ data }) => {
        setPgn((data as PgnRow) ?? null);
        setLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pgnId]);

  const parsed = useMemo(() => (pgn ? parsePgn(pgn.content) : null), [pgn]);

  // Keyboard navigation
  useEffect(() => {
    if (!parsed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIdx((i) => Math.min(parsed.moves.length, i + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [parsed]);

  const back = (
    <div className="mb-4 text-sm">
      <Link href={`/${role}/dashboard/${academyId}/folders`} className="text-muted-foreground hover:text-foreground">
        ← Content Library
      </Link>
    </div>
  );

  if (loading) return <div>{back}<p className="text-muted-foreground py-12 text-center">Loading…</p></div>;
  if (!pgn || !parsed) return <div>{back}<EmptyState text="PGN not found." /></div>;

  const fen = parsed.fens[Math.min(idx, parsed.fens.length - 1)];
  const last = idx > 0 ? parsed.moves[idx - 1] : undefined;
  const h = parsed.headers;
  const subtitle = [h.White && h.Black ? `${h.White} vs ${h.Black}` : null, h.Event !== "?" ? h.Event : null, h.Result !== "?" ? h.Result : null]
    .filter(Boolean)
    .join(" · ");

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast(`${label} copied`, "success");
  };

  return (
    <div>
      {back}
      <PageHeader title={pgn.title} subtitle={subtitle || undefined} />
      {parsed.error && <p className="text-sm text-destructive mb-4">Parse warning: {parsed.error}</p>}

      {/* Board gets real primary-viewport width (was capped at 520px); the
          move panel is a fixed, independently-scrolling column matched to
          it, not a short box that clips a long game. */}
      <div className="flex flex-col lg:flex-row gap-6 lg:items-stretch">
        <div className="w-full lg:w-[560px] xl:w-[640px] shrink-0 flex flex-col">
          <div className="aspect-square w-full">
            <ChessBoard fen={fen} lastMove={last ? { from: last.from, to: last.to } : undefined} />
          </div>
          <div className="flex items-center justify-center gap-2 mt-4">
            <Button variant="secondary" className="!px-3" onClick={() => setIdx(0)} disabled={idx === 0}>⏮</Button>
            <Button variant="secondary" className="!px-3" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}>◀</Button>
            <span className="text-sm text-muted-foreground min-w-20 text-center">
              {idx}/{parsed.moves.length}
            </span>
            <Button variant="secondary" className="!px-3" onClick={() => setIdx((i) => Math.min(parsed.moves.length, i + 1))} disabled={idx >= parsed.moves.length}>▶</Button>
            <Button variant="secondary" className="!px-3" onClick={() => setIdx(parsed.moves.length)} disabled={idx >= parsed.moves.length}>⏭</Button>
          </div>
          <div className="flex justify-center gap-2 mt-3">
            <Button variant="ghost" className="text-sm" onClick={() => copy(fen, "FEN")}>Copy FEN</Button>
            <Button variant="ghost" className="text-sm" onClick={() => copy(pgn.content, "PGN")}>Copy PGN</Button>
          </div>
        </div>

        <Card className="flex-1 min-w-0 flex flex-col lg:max-h-[calc(100vh-14rem)]">
          <h3 className="text-sm font-medium text-muted-foreground mb-3 shrink-0">Moves</h3>
          {parsed.moves.length === 0 ? (
            <p className="text-sm text-muted-foreground">No moves in this PGN.</p>
          ) : (
            <div className="flex-1 overflow-y-auto pr-1">
              <div className="flex flex-wrap content-start gap-1.5 text-sm font-mono">
                {parsed.moves.map((m, i) => (
                  <span key={i} className="inline-flex items-center">
                    {i % 2 === 0 && (
                      <span className="text-muted-foreground mr-1">{Math.floor(i / 2) + 1}.</span>
                    )}
                    <button
                      onClick={() => setIdx(i + 1)}
                      className={`px-2 py-1 rounded-btn transition-colors ${
                        idx === i + 1 ? "bg-primary text-white" : "hover:bg-surface-3"
                      }`}
                    >
                      {m.san}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
