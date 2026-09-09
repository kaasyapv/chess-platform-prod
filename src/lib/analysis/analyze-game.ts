/* Whole-game analysis driver - walks a game through Stockfish (WASM, in a Web
 * Worker) and returns one judgement per move.
 *
 * Why a second engine path when use-stockfish.ts exists: that hook is a live,
 * reactive "what does the engine think about the position on screen" feed. This
 * is a batch job over N positions that has to run to completion and report
 * progress. Same worker binary, different shape - one promise per position.
 *
 * The whole thing runs client-side: no server, no per-move cost.
 */

import { Chess } from "chess.js";
import { classifyMove, gameAccuracy, type MoveTier } from "./classify";

/** Mate scores are clamped so a forced mate does not produce an absurd
 *  centipawn "loss" that swamps the accuracy average. */
const MATE_CP = 10_000;

export type PositionEval = {
  /** Centipawns, positive = good for the side to move. */
  score: number;
  mate: number | null;
  /** Engine's preferred move, UCI ("e2e4"). */
  bestMove: string;
};

export type AnalysedMove = {
  ply: number;
  san: string;
  uci: string;
  /** FEN before the move was played. */
  fenBefore: string;
  tier: MoveTier;
  centipawnLoss: number;
  /** The move the engine would have played instead, UCI. */
  bestMove: string;
  /** Eval after the move, White-relative centipawns - drives the graph. */
  evalAfter: number;
};

export type GameReport = {
  moves: AnalysedMove[];
  accuracyWhite: number;
  accuracyBlack: number;
};

/** Piece values in pawns - for spotting a real sacrifice. */
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Material on the board for one colour, in pawns. */
function material(chess: Chess, color: "w" | "b"): number {
  return chess.board().flat().reduce(
    (sum, sq) => (sq && sq.color === color ? sum + (VALUE[sq.type] ?? 0) : sum),
    0,
  );
}

/** Signed centipawns, collapsing a mate score onto the same axis. */
function toCp(e: PositionEval): number {
  if (e.mate == null) return e.score;
  return e.mate > 0 ? MATE_CP : -MATE_CP;
}

/**
 * One Stockfish worker, driven imperatively. `evaluate` resolves once the
 * engine reports `bestmove` for the position, so callers can await positions in
 * sequence without the engine's output from one bleeding into the next.
 */
export class GameAnalyser {
  private worker: Worker;
  private ready: Promise<void>;

  constructor(private depth = 12) {
    this.worker = new Worker("/engine/stockfish.js");
    this.ready = new Promise<void>((resolve) => {
      const onMsg = (e: MessageEvent<string>) => {
        if (e.data === "readyok") {
          this.worker.removeEventListener("message", onMsg);
          resolve();
        }
      };
      this.worker.addEventListener("message", onMsg);
      // MultiPV 1: a batch pass only needs the engine's single best line, and
      // asking for three would triple the work for output we throw away.
      this.worker.postMessage("uci");
      this.worker.postMessage("setoption name MultiPV value 1");
      this.worker.postMessage("isready");
    });
  }

  evaluate(fen: string): Promise<PositionEval> {
    return new Promise((resolve) => {
      let score = 0;
      let mate: number | null = null;

      const onMsg = (e: MessageEvent<string>) => {
        const line = e.data;
        if (typeof line !== "string") return;

        if (line.startsWith("info") && line.includes(" pv ")) {
          const cp = line.match(/score cp (-?\d+)/);
          const mt = line.match(/score mate (-?\d+)/);
          if (cp) { score = parseInt(cp[1], 10); mate = null; }
          if (mt) { mate = parseInt(mt[1], 10); }
        }

        if (line.startsWith("bestmove")) {
          this.worker.removeEventListener("message", onMsg);
          resolve({ score, mate, bestMove: line.split(" ")[1] ?? "" });
        }
      };

      this.worker.addEventListener("message", onMsg);
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(`go depth ${this.depth}`);
    });
  }

  /**
   * Analyse every move of a game.
   *
   * The engine is asked about each position ONCE (N+1 evaluations for N moves),
   * not twice per move: the eval of the position after move i is exactly the
   * eval the engine already gave for position i+1, just seen from the other
   * side. Centipawn loss therefore falls out as
   *
   *     loss = eval(before) - (-eval(after)) = eval(before) + eval(after)
   *
   * because engine scores are relative to whoever is on move.
   */
  async analyseGame(
    pgnOrFen: { pgn?: string; startFen?: string; sanMoves: string[] },
    onProgress?: (done: number, total: number) => void,
  ): Promise<GameReport> {
    await this.ready;

    const { startFen, sanMoves } = pgnOrFen;
    const chess = startFen ? new Chess(startFen) : new Chess();

    // Replay the game, recording the position before each move.
    const fens: string[] = [chess.fen()];
    const played: { san: string; uci: string; sacrificed: number }[] = [];

    for (const san of sanMoves) {
      const mover = chess.turn();
      const before = material(chess, mover);
      const move = chess.move(san);
      if (!move) break; // illegal/garbage tail - analyse what we could parse
      const after = material(chess, mover);
      played.push({
        san,
        uci: `${move.from}${move.to}${move.promotion ?? ""}`,
        sacrificed: before - after,
      });
      fens.push(chess.fen());
    }

    const total = fens.length;
    const evals: PositionEval[] = [];
    for (let i = 0; i < total; i++) {
      evals.push(await this.evaluate(fens[i]));
      onProgress?.(i + 1, total);
    }

    const moves: AnalysedMove[] = [];
    const lossesWhite: number[] = [];
    const lossesBlack: number[] = [];

    for (let i = 0; i < played.length; i++) {
      const before = evals[i];
      const after = evals[i + 1];
      if (!after) break;

      const rawLoss = toCp(before) + toCp(after);
      // Loss is never negative: finding a move better than the engine's own
      // pick at this depth means the engine was simply short-sighted, not that
      // the player gained centipawns out of thin air.
      const centipawnLoss = Math.max(0, Math.min(rawLoss, MATE_CP));

      const moverIsWhite = fens[i].split(" ")[1] === "w";
      // eval after the move, from the mover's side, then flipped to White-relative.
      const evalAfterMover = -toCp(after);
      const evalAfterWhite = moverIsWhite ? evalAfterMover : -evalAfterMover;

      const tier = classifyMove({
        ply: i,
        centipawnLoss,
        wasTop: before.bestMove === played[i].uci,
        materialSacrificed: played[i].sacrificed,
        evalAfter: evalAfterMover,
      });

      moves.push({
        ply: i,
        san: played[i].san,
        uci: played[i].uci,
        fenBefore: fens[i],
        tier,
        centipawnLoss,
        bestMove: before.bestMove,
        evalAfter: evalAfterWhite,
      });

      (moverIsWhite ? lossesWhite : lossesBlack).push(centipawnLoss);
    }

    return {
      moves,
      accuracyWhite: gameAccuracy(lossesWhite),
      accuracyBlack: gameAccuracy(lossesBlack),
    };
  }

  destroy() {
    this.worker.postMessage("quit");
    this.worker.terminate();
  }
}
