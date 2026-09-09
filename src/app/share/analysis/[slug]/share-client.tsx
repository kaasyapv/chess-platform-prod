"use client";

import { useMemo, useState } from "react";
import { Chess } from "chess.js";
import { ChessBoard, type Arrow, type Highlight } from "@/components/board/chess-board";
import { Button, Card } from "@/components/ui";

type Analysis = {
  title: string;
  description: string | null;
  pgn: string;
  annotations: { arrows?: Arrow[]; highlights?: Highlight[]; fen?: string };
  created_at: string;
};

export function ShareAnalysisClient({ analysis }: { analysis: Analysis }) {
  const history = useMemo(() => {
    try {
      const c = new Chess();
      c.loadPgn(analysis.pgn);
      return c.history();
    } catch { return []; }
  }, [analysis.pgn]);

  const [viewPly, setViewPly] = useState(history.length);

  const fen = useMemo(() => {
    const c = new Chess(analysis.annotations?.fen && history.length === 0 ? analysis.annotations.fen : undefined);
    try { for (let i = 0; i < viewPly; i++) c.move(history[i]); } catch { /* end */ }
    return c.fen();
  }, [viewPly, history, analysis.annotations]);

  const movePairs: { n: number; w?: string; b?: string }[] = [];
  history.forEach((san, i) => {
    if (i % 2 === 0) movePairs.push({ n: i / 2 + 1, w: san });
    else movePairs[movePairs.length - 1].b = san;
  });

  return (
    <main className="min-h-screen p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">{analysis.title}</h1>
      <p className="text-muted-foreground mb-4">{new Date(analysis.created_at).toLocaleDateString()}</p>
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="w-[min(88vw,560px)] aspect-square">
          <ChessBoard
            fen={fen}
            arrows={viewPly === history.length ? analysis.annotations?.arrows ?? [] : []}
            highlights={viewPly === history.length ? analysis.annotations?.highlights ?? [] : []}
          />
        </div>
        <Card className="flex-1 min-w-64">
          {analysis.description && <p className="text-sm mb-4">{analysis.description}</p>}
          <div className="max-h-80 overflow-y-auto border border-border rounded-btn">
            <table className="w-full text-sm">
              <tbody>
                {movePairs.map((p) => (
                  <tr key={p.n} className="border-t border-border first:border-0">
                    <td className="px-3 py-1 text-muted-foreground w-10">{p.n}</td>
                    <td className={`px-2 py-1 cursor-pointer ${viewPly === p.n * 2 - 1 ? "text-primary-hover font-semibold" : ""}`}
                        onClick={() => setViewPly(p.n * 2 - 1)}>{p.w}</td>
                    <td className={`px-2 py-1 cursor-pointer ${viewPly === p.n * 2 ? "text-primary-hover font-semibold" : ""}`}
                        onClick={() => p.b && setViewPly(p.n * 2)}>{p.b ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-center gap-1 mt-3">
            <Button variant="ghost" onClick={() => setViewPly(0)}>⏮</Button>
            <Button variant="ghost" onClick={() => setViewPly(Math.max(0, viewPly - 1))}>◀</Button>
            <Button variant="ghost" onClick={() => setViewPly(Math.min(history.length, viewPly + 1))}>▶</Button>
            <Button variant="ghost" onClick={() => setViewPly(history.length)}>⏭</Button>
          </div>
        </Card>
      </div>
    </main>
  );
}
