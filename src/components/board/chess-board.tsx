"use client";

/* Shared chess board - ONE component serving Classroom, Play Area and
 * Analysis. Rendered with chessground (DOM/SVG). The board colours, piece set
 * and highlight colours are ALL driven by a per-instance <style> block instead
 * of imperative inline styles, so they survive chessground's redrawAll() (which
 * fires on resize / flip and would otherwise wipe an inline board background -
 * the old cause of the "board turns black on flip / blank board" bugs).
 *
 * Resizing is chessground's job. It watches the wrapper with its own
 * ResizeObserver and re-measures the squares. Do not add another one here, and
 * do not scale the board with a CSS transform: both break the click map, which
 * is what made a click on e8 select d8.
 */

import "chessground/assets/chessground.base.css";
import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useImperativeHandle, forwardRef, memo,
} from "react";
import { Chess } from "chess.js";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Key, Color } from "chessground/types";
import type { DrawShape } from "chessground/draw";
import { pieceSetCss } from "./piece-sets";
import { BOARD_THEMES, HIGHLIGHTS } from "@/lib/board-settings";
import { GamifiedIcon } from "@/lib/gamified-icons";
import { applyBlocked } from "@/lib/gamify-moves";

/** useLayoutEffect warns when a client component is rendered on the server.
 *  Fall back to useEffect there; the browser always gets the layout effect. */
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export type Arrow = { from: string; to: string; color?: string };
export type Highlight = { square: string; color?: string };

export type ChessBoardHandle = {
  getFen: () => string;
  playPremove: () => boolean;
  cancelPremove: () => void;
  /** Force chessground's board to `fen` even when the React `fen` prop is
   *  unchanged — used to snap a pawn back after a cancelled promotion, where
   *  chessground has already moved it visually but the position never changed. */
  setPosition: (fen: string) => void;
};

type Props = {
  fen: string;
  orientation?: Color;
  movable?: boolean | Color;
  free?: boolean;
  arrows?: Arrow[];
  highlights?: Highlight[];
  /** Gamified board stickers - algebraic square -> gamified-icons.tsx id, drawn over the square. */
  icons?: Record<string, string>;
  /** Gamified board obstacles - squares a piece may not move onto or slide
   *  through (rocks / walls). Rewards stay capturable; only these block. */
  blockedSquares?: string[];
  autoArrows?: Arrow[];
  lastMove?: { from: string; to: string };
  lastMoveMode?: "none" | "highlight" | "arrow";
  check?: boolean;
  /** Show a-h / 1-8 in the margin outside the board. */
  coordinates?: boolean;
  showLegal?: boolean;
  animation?: boolean;
  /** slow glide (150ms) vs snappy (60ms) */
  smoothMoves?: boolean;
  /** allow dragging pieces (vs click-only) */
  dragAnimation?: boolean;
  /** highlight the king square when in check */
  highlightChecks?: boolean;
  /** drop-shadow under pieces */
  pieceShadows?: boolean;
  /** fading trail on the last move */
  moveTrails?: boolean;
  /** hide the pieces - move logic (dests, drag, click, arrows) all stay on */
  blindfold?: boolean;
  premove?: boolean;
  /** 0.85 - 1.15 zoom */
  boardZoom?: number;
  boardTheme?: string;
  pieceSet?: string;
  onMove?: (from: string, to: string) => void;
  onFreeMove?: (pieceFen: string, from: string, to: string) => void;
  onPremove?: (from: string, to: string) => void;
  onAnnotate?: (arrows: Arrow[], highlights: Highlight[]) => void;
};

function splitShapes(shapes: DrawShape[]): { arrows: Arrow[]; highlights: Highlight[] } {
  const arrows: Arrow[] = [];
  const highlights: Highlight[] = [];
  for (const s of shapes) {
    const color = s.brush ?? "green";
    if (s.dest && s.dest !== s.orig) arrows.push({ from: s.orig, to: s.dest, color });
    else highlights.push({ square: s.orig, color });
  }
  return { arrows, highlights };
}

function getDests(fen: string, color: Color | "both", blocked?: Set<string>): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  let chess: Chess;
  try { chess = new Chess(fen); } catch { return dests; }
  for (const m of chess.moves({ verbose: true })) {
    if (color !== "both" && m.color !== (color === "white" ? "w" : "b")) continue;
    const existing = dests.get(m.from as Key) ?? [];
    existing.push(m.to as Key);
    dests.set(m.from as Key, existing);
  }
  return blocked ? applyBlocked(dests, blocked) : dests;
}

function resolveMovable(
  fen: string, movable: boolean | Color | undefined, free: boolean | undefined,
  blockedSquares?: string[],
) {
  if (!movable) return { color: undefined as Color | undefined, dests: new Map<Key, Key[]>(), free: false };
  if (free) return { color: "both" as Color, dests: new Map<Key, Key[]>(), free: true };
  const blocked = blockedSquares?.length ? new Set(blockedSquares) : undefined;
  if (movable === true) return { color: "both" as Color, dests: getDests(fen, "both", blocked), free: false };
  return { color: movable as Color, dests: getDests(fen, movable as Color, blocked), free: false };
}

function turnColor(fen: string): Color {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

function buildUserShapes(arrows: Arrow[], highlights: Highlight[]): DrawShape[] {
  return [
    ...arrows.map((a) => ({ orig: a.from as Key, dest: a.to as Key, brush: a.color ?? "green" })),
    ...highlights.map((h) => ({ orig: h.square as Key, brush: h.color ?? "green" })),
  ];
}

/* Arrow geometry, straight from MICRO_INTERACTIONS_AND_INTEGRATIONS.md §2.5:
 * stroke-width = squareSize / 6, opacity 0.5, triangle marker. chessground
 * divides brush.lineWidth by 64 in an 8-unit board, so lineWidth 64/6 ≈ 10.67
 * resolves to exactly one-sixth of a square. The four annotation brushes carry
 * the spec palette (red default, green, blue, orange). */
const ARROW_STROKE = 64 / 6;
const ARROW_OPACITY = 0.5;

/** Draw brushes with the exact goal-spec colours. */
const BRUSHES = {
  green:  { key: "green",  color: "#22C55E", opacity: ARROW_OPACITY, lineWidth: ARROW_STROKE },
  red:    { key: "red",    color: "#EF4444", opacity: ARROW_OPACITY, lineWidth: ARROW_STROKE },
  blue:   { key: "blue",   color: "#3B82F6", opacity: ARROW_OPACITY, lineWidth: ARROW_STROKE },
  yellow: { key: "yellow", color: "#F97316", opacity: ARROW_OPACITY, lineWidth: ARROW_STROKE },
  coach:  { key: "coach",  color: HIGHLIGHTS.coachArrow,   opacity: 0.9, lineWidth: 12 },
  student:{ key: "student",color: HIGHLIGHTS.studentArrow, opacity: 0.9, lineWidth: 10 },
  engine: { key: "engine", color: HIGHLIGHTS.engine,       opacity: 0.85, lineWidth: 10 },
  quiz:   { key: "quiz",   color: HIGHLIGHTS.quiz,         opacity: 0.9, lineWidth: 12 },
  paleGreen: { key: "paleGreen", color: HIGHLIGHTS.legal,  opacity: 0.4, lineWidth: 10 },
  paleBlue:  { key: "paleBlue",  color: HIGHLIGHTS.engine, opacity: 0.5, lineWidth: 10 },
};

/** The wooden frame around the board - fixed across every theme, confirmed
 *  live against the reference (`.chessboard-inner` background stays this
 *  colour regardless of the site's light/dark toggle). Only the square
 *  colours (BOARD_THEMES[].dark/light) are theme-selectable. */
const BOARD_FRAME_COLOR = "#8B4513";

/** SVG checkerboard for a theme, as a CSS url() - used as the board background. */
function themeBoardUrl(dark: string, light: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges"><rect width="8" height="8" fill="${light}"/>${
    Array.from({ length: 8 }, (_, r) =>
      Array.from({ length: 8 }, (_, c) =>
        (r + c) % 2 === 1 ? `<rect x="${c}" y="${r}" width="1" height="1" fill="${dark}"/>` : ""
      ).join("")).join("")
  }</svg>`;
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}

/* memo: the classroom re-renders on chat, timers and roster changes. Without
 * this the board re-runs on every one of them, which is what made a click feel
 * slow. Its props are primitives and stable useCallbacks, so a shallow compare
 * is enough. */
const ChessBoardImpl = forwardRef<ChessBoardHandle, Props>(function ChessBoard({
  fen,
  orientation = "white",
  movable = false,
  free = false,
  arrows = [],
  highlights = [],
  icons = {},
  blockedSquares,
  autoArrows = [],
  lastMove,
  lastMoveMode = "highlight",
  check = false,
  coordinates = true,
  showLegal = true,
  animation = true,
  smoothMoves = true,
  dragAnimation = true,
  highlightChecks = true,
  pieceShadows = false,
  moveTrails = true,
  blindfold = false,
  premove = false,
  boardZoom = 1,
  boardTheme = "tournament",
  pieceSet = "cburnett",
  onMove,
  onFreeMove,
  onPremove,
  onAnnotate,
}, ref) {
  const el = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cg = useRef<Api | null>(null);
  /** Last rect we told chessground about - used to spot the board moving. */
  const lastRect = useRef<DOMRect | null>(null);
  const onMoveRef = useRef(onMove);
  const onFreeMoveRef = useRef(onFreeMove);
  const onPremoveRef = useRef(onPremove);
  const onAnnotateRef = useRef(onAnnotate);
  // The `after` handler below is installed once, on mount. Read `free` through
  // a ref so toggling Free Move later still routes the move to the right place.
  const freeRef = useRef(free);
  onMoveRef.current = onMove;
  onFreeMoveRef.current = onFreeMove;
  onPremoveRef.current = onPremove;
  onAnnotateRef.current = onAnnotate;
  freeRef.current = free;

  // Stable per-instance class so the injected <style> only targets this board.
  const instClass = `cgi-${useId().replace(/[:]/g, "")}`;

  useImperativeHandle(ref, () => ({
    getFen: () => cg.current?.getFen() ?? "",
    playPremove: () => cg.current?.playPremove() ?? false,
    cancelPremove: () => cg.current?.cancelPremove(),
    setPosition: (f: string) => cg.current?.set({ fen: f }),
  }));

  const showLastMove = lastMoveMode === "highlight" && lastMove;
  // Piece glide is a CSS transition now (MICRO_INTERACTIONS_AND_INTEGRATIONS.md
  // §2.1: `transform 140ms cubic-bezier(.25,.1,.25,1)`), not chessground's
  // main-thread rAF tween - it runs on the compositor and matches the reference
  // curve exactly. chessground's own animation is switched off below so the two
  // don't fight over `transform`. "Snappy" lands the piece near-instantly; the
  // full 140ms glide is for people who keep Smooth moves on.
  const pieceTransitionMs = animation ? (smoothMoves ? 140 : 60) : 0;
  const autoShapes: DrawShape[] = [
    ...(lastMoveMode === "arrow" && lastMove
      ? [{ orig: lastMove.from as Key, dest: lastMove.to as Key, brush: "paleGreen" }]
      : []),
    ...autoArrows.map((a) => ({ orig: a.from as Key, dest: a.to as Key, brush: a.color ?? "engine" })),
  ];

  // Mount once
  useEffect(() => {
    if (!el.current) return;
    const { color, dests, free: isFree } = resolveMovable(fen, movable, free, blockedSquares);

    const instance = Chessground(el.current, {
      fen,
      orientation,
      turnColor: turnColor(fen),
      check: highlightChecks && check,
      movable: {
        free: isFree,
        color,
        dests,
        showDests: showLegal && !isFree,
        events: {
          after: (from: Key, to: Key) => {
            if (freeRef.current) onFreeMoveRef.current?.(instance.getFen(), from, to);
            else onMoveRef.current?.(from, to);
          },
        },
      },
      premovable: {
        enabled: premove && !isFree,
        showDests: showLegal,
        events: { set: (from: Key, to: Key) => onPremoveRef.current?.(from, to) },
      },
      draggable: { enabled: dragAnimation && !!movable, showGhost: true },
      selectable: { enabled: !!movable },
      animation: { enabled: false },
      highlight: { lastMove: !!showLastMove, check: highlightChecks },
      coordinates: false, // we draw our own frame in the outer margin
      drawable: {
        enabled: true,
        visible: true,
        eraseOnClick: false,
        defaultSnapToValidMove: false,
        brushes: BRUSHES,
        shapes: buildUserShapes(arrows, highlights),
        autoShapes,
        onChange: (shapes: DrawShape[]) => {
          const { arrows: a, highlights: h } = splitShapes(shapes);
          onAnnotateRef.current?.(a, h);
        },
      },
      lastMove: lastMove && lastMoveMode !== "none"
        ? [lastMove.from as Key, lastMove.to as Key] : undefined,
    });

    cg.current = instance;
    lastRect.current = el.current.getBoundingClientRect();

    /* Do NOT add a ResizeObserver that calls redrawAll() here.
     *
     * Chessground already watches the wrapper (see bindBoard() in
     * chessground/src/events.ts: `new ResizeObserver(onResize).observe(wrap)`),
     * and its onResize re-measures the board. redrawAll() would rebuild the DOM
     * and call bindBoard() again, installing yet another observer every time -
     * they pile up and every resize turns into a cascade of rebuilds.
     *
     * What chessground does NOT catch is the board being MOVED without being
     * resized. It caches the board's rect, including left/top, and only throws
     * that cache away on scroll, on window resize, and when the wrapper changes
     * size. The sidebar slides from w-60 to w-14 when you open a classroom, so
     * the board shifts sideways by about one square while keeping its size -
     * and every click lands one file off. `syncBounds` below fixes that. */

    return () => { instance.destroy(); cg.current = null; lastRect.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Keep chessground's cached board rect honest.
   *
   * chessground clears that cache when the window resizes (events.ts binds
   * `window resize -> bounds.clear()`), so dispatching a resize is the cheap,
   * supported way to force a fresh measurement. It costs one getBoundingClientRect
   * and never touches the DOM.
   *
   * We do it when the board has actually moved or changed size:
   *  - right after mount, once the first paint has settled;
   *  - when a CSS transition ends anywhere (the sidebar sliding open or shut);
   *  - just before any pointer press, so a click can never use a stale rect.
   * Runs on every mount and unbinds on every unmount, so a re-login re-attaches
   * cleanly. */
  useIsomorphicLayoutEffect(() => {
    const syncBounds = () => {
      const rect = el.current?.getBoundingClientRect();
      if (!rect) return;
      const prev = lastRect.current;
      const moved = !prev
        || prev.left !== rect.left || prev.top !== rect.top
        || prev.width !== rect.width || prev.height !== rect.height;
      if (!moved) return;
      lastRect.current = rect;
      window.dispatchEvent(new Event("resize"));
    };

    // `transitionend` bubbles to the document from every `transition-colors`
    // button in the classroom - dozens per second during a hover storm. Coalesce
    // those to one rect read per frame. The `pointerdown` path stays synchronous:
    // it fires before chessground's `mousedown`, so that click must see a fresh
    // rect immediately, not next frame.
    let queued = 0;
    const syncBoundsRAF = () => {
      if (queued) return;
      queued = requestAnimationFrame(() => { queued = 0; syncBounds(); });
    };

    // After the first paint, and again once late layout (fonts, the sidebar
    // collapsing in its own effect) has settled.
    const raf = requestAnimationFrame(syncBounds);
    const settle = setTimeout(syncBounds, 400);

    document.addEventListener("pointerdown", syncBounds, { capture: true });
    document.addEventListener("transitionend", syncBoundsRAF, { capture: true });

    return () => {
      cancelAnimationFrame(raf);
      if (queued) cancelAnimationFrame(queued);
      clearTimeout(settle);
      document.removeEventListener("pointerdown", syncBounds, { capture: true });
      document.removeEventListener("transitionend", syncBoundsRAF, { capture: true });
    };
  }, []);

  // Sync on prop changes
  useEffect(() => {
    const api = cg.current;
    if (!api) return;
    const { color, dests, free: isFree } = resolveMovable(fen, movable, free, blockedSquares);
    api.set({
      fen,
      orientation,
      turnColor: turnColor(fen),
      check: highlightChecks && check,
      movable: { free: isFree, color, dests, showDests: showLegal && !isFree },
      premovable: { enabled: premove && !isFree, showDests: showLegal },
      draggable: { enabled: dragAnimation && !!movable, showGhost: true },
      selectable: { enabled: !!movable },
      animation: { enabled: false },
      coordinates: false, // we draw our own frame/labels; never let cg add its own
      highlight: { lastMove: !!showLastMove, check: highlightChecks },
      lastMove: lastMove && lastMoveMode !== "none"
        ? [lastMove.from as Key, lastMove.to as Key] : undefined,
    });
    // `coordinates`, `animation` and `smoothMoves` are deliberately NOT deps:
    // chessground always gets `coordinates: false` and `animation: { enabled:
    // false }` here (we draw our own frame; the glide is a CSS transition), so a
    // coords toggle re-running this effect only made it re-`set` an unchanged
    // fen and shimmer the pieces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, orientation, movable, free, lastMove,
      lastMoveMode, check, showLegal,
      dragAnimation, highlightChecks, premove,
      (blockedSquares ?? []).join(",")]);

  /* Shapes sync BY VALUE, not by reference. The engine emits a new lines array
   * on every info tick, so the "best move" arrow prop gets a fresh identity
   * dozens of times per search even though from/to never change - and every
   * setAutoShapes() call makes chessground rebuild its SVG, which reads as a
   * micro-vibration of the arrow. Keying the effect on the serialized shapes
   * means an identical arrow never redraws. */
  const userShapesJson = JSON.stringify(buildUserShapes(arrows, highlights));
  const autoShapesJson = JSON.stringify(autoShapes);
  useEffect(() => {
    cg.current?.setShapes(JSON.parse(userShapesJson));
  }, [userShapesJson]);
  useEffect(() => {
    cg.current?.setAutoShapes(JSON.parse(autoShapesJson));
  }, [autoShapesJson]);

  /* Board zoom - resize the wrapper for real, do NOT use a CSS transform.
   * chessground sizes its board in pixels read from the wrapper's rect. A
   * transform changes that rect without changing layout, so the board gets
   * scaled twice and every square lands in the wrong place. Changing the
   * width/height changes layout, chessground's own ResizeObserver sees it, and
   * the square bounds refresh on their own. */
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const size = `${Math.round(boardZoom * 100)}%`;
    wrap.style.width = size;
    wrap.style.height = size;
  }, [boardZoom]);

  // Board theme + piece set + highlight CSS - one <style>, always in the DOM,
  // scoped to this board instance. Survives redrawAll(), so flipping never
  // blanks the board.
  const styleCss = useMemo(() => {
    const theme = BOARD_THEMES.find((t) => t.id === boardTheme) ?? BOARD_THEMES[0];
    const boardUrl = themeBoardUrl(theme.dark, theme.light);
    // Real Lichess artwork for every set, this board only.
    const pieceCss = pieceSetCss(`.${instClass}`, pieceSet);
    return `
      /* The board sits in a bordered box. Rank numbers go in the margin to its
         left, file letters in the margin below it. Nothing is drawn inside a
         square. */
      /* Sizing, straight from the reference platform (playmate-ui-analysis.md
         §1): the container is a size container (container-type: size) and
         the board takes the largest square that fits its short edge - never
         a transform, which would desync the click map. */
      /* The coordinate gutters SCALE WITH THE BOARD. They used to be a flat
         1.4rem, which is fine at 600px and wrong everywhere else: in a small
         side-panel preview a fixed gutter eats a large fraction of the box and
         the labels overflow their track (clipped coordinates, squashed board).
         cqmin ties both the gutter and the type to the container's short edge,
         and the clamp keeps them legible at the small end and from ballooning
         at the large end. One framework, any size. */
      .${instClass} {
        container-type: size;
        position: relative;
        --cgi-gutter: clamp(0.65rem, 2.6cqmin, 1.2rem);
        --cgi-coord: clamp(7px, 3cqmin, 15px);
        /* Every rail and the board itself read their size from this ONE
           calc() string. Textually identical calc() expressions resolve to
           the same length wherever they appear in the same container-query
           context, so the board, the rank rail's height and the file rail's
           width are guaranteed bit-identical - unlike CSS Grid, which lays
           out column tracks and row tracks in two separate passes and can
           round each pass's fractional remainder differently even given a
           single shared gutter variable (measured: a visible thicker seam on
           one side, the bug this replaces). The reference platform never
           hits this because it never divides the board's own box at all:
           the square is one undivided element, and the coordinate rails are
           absolutely-positioned overlays OUTSIDE it (playmate-ui-analysis.md
           §1, .class-files / .class-ranks). Every caller already hands this
           component a pre-squared container (aspect-square / equal
           width+height), so anchoring at (0,0) instead of centering loses
           nothing. */
        /* Fixed wood-frame ring (the reference's flat 6px). One variable so the
           board box, the outline and the coordinate rails can't disagree. */
        --cgi-frame: 6px;
        /* --cgi-inner is the SQUARE AREA chessground actually paints, floored to
           a whole multiple of 8px so its 8 tracks divide it exactly. A
           fractional value made chessground floor its OWN board down and leave a
           ~4px gap on the right file and bottom rank, and spread the coordinate
           rails across a wider track than the squares - the "mismatch on the
           bottom row and the right side". round() is in every current engine
           (Chrome 125+ / Firefox 118+ / Safari 15.4+); the plain calc() above
           it is the fallback for older ones (they keep the pre-fix behaviour).
           ponytail: drop the fallback line once those are all off support. */
        --cgi-inner: calc(min(100cqw, 100cqh) - var(--cgi-gutter) - 2 * var(--cgi-frame));
        --cgi-inner: round(down, calc(min(100cqw, 100cqh) - var(--cgi-gutter) - 2 * var(--cgi-frame)), 8px);
        /* Frame outer edge = the square area plus the ring on both sides. */
        --cgi-square: calc(var(--cgi-inner) + 2 * var(--cgi-frame));
      }
      .${instClass} .cgi-frame {
        position: absolute;
        left: var(--cgi-gutter);
        top: 0;
        width: var(--cgi-square);
        height: var(--cgi-square);
      }
      .${instClass} .cgi-board {
        position: absolute;
        /* Confirmed against the live reference via DOM inspection: there is no
           CSS border on the board at all - the "frame" is a fixed 6px ring
           around it (their chessboard-inner is p-1.5, not a cqmin-scaled
           value), square corners (0 radius). Clamped only at the very small
           end (120px PGN-library previews) so the frame doesn't swallow the
           board there - at any size the reference itself actually runs at,
           this clamp is already pinned to the flat 6px they use.
           Painted with outline, not background + padding: outline is a
           layout-independent paint property - it never resizes or reflows the
           box, so the browser has no fractional-remainder to round differently
           per side the way a layout track (grid/flex column, or padding
           interacting with a sub-pixel container width) can. inset reserves
           the same ring of space padding used to; the outline then paints
           exactly into that reserved ring (outline-offset: 0 draws it flush
           against the box edge), so the visible frame is pixel-identical on
           all four sides at any container size, fractional or not.
           The colour itself is a FIXED constant (BOARD_FRAME_COLOR), confirmed
           live: the reference's frame stays the same wood-brown regardless of
           the site's light/dark toggle. It does not follow the selected board
           theme - only the square colours (theme.dark/theme.light) do. */
        inset: var(--cgi-frame);
        outline-width: var(--cgi-frame);
        outline-style: solid;
        outline-color: ${BOARD_FRAME_COLOR};
        outline-offset: 0;
        border-radius: 0;
        overflow: hidden;
        min-width: 0; min-height: 0;
      }
      /* Chessground's own elements fill that box exactly. No padding, no
         margin, no border anywhere inside: any of those would move the painted
         squares away from the squares chessground reads clicks against. */
      .${instClass} .cgi-board > div,
      .${instClass} .cg-wrap {
        width: 100%; height: 100%; display: block;
      }
      .${instClass} .cg-wrap,
      .${instClass} cg-container,
      .${instClass} cg-board {
        box-sizing: border-box;
        margin: 0; padding: 0; border: 0;
      }
      /* Coordinates live in the margin, never inside a square - same as the
         reference's .class-files / .class-ranks gutters, same type ramp.
         Positioned in the instClass container's own gutter margin (left of
         and below .cgi-frame), sized from the same --cgi-square/--cgi-gutter
         variables as the board, so they never share a layout track with it
         and can't perturb its squareness. */
      .${instClass} .cgi-ranks, .${instClass} .cgi-files {
        position: absolute;
        display: flex;
        /* Gutter sits on the page/card background, not the wood frame - so
           this has to track --foreground, not a fixed white (was invisible
           on a light-mode white card). */
        color: var(--muted-foreground);
        font-size: var(--cgi-coord); font-weight: 600; letter-spacing: 0.6px;
        line-height: 1;
        user-select: none;
        pointer-events: none;
        overflow: hidden;
        transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      }
      /* Rails span the SQUARE AREA (--cgi-inner), inset by the frame ring - not
         the frame's outer box - so every label sits dead-centre on its file /
         rank, edges included. */
      .${instClass} .cgi-ranks {
        left: 0; top: var(--cgi-frame);
        width: var(--cgi-gutter);
        height: var(--cgi-inner);
        flex-direction: column;
        justify-content: space-around; align-items: center;
      }
      .${instClass} .cgi-files {
        left: calc(var(--cgi-gutter) + var(--cgi-frame)); top: var(--cgi-square);
        width: var(--cgi-inner);
        height: var(--cgi-gutter);
        flex-direction: row;
        justify-content: space-around; align-items: center;
      }
      /* Gamified board stickers. A child of .cgi-board (not a sibling inside
         .cgi-frame) so its box lines up exactly with .cgi-board's own content
         area - i.e. where chessground draws the squares, inset by the same
         frame thickness - rather than .cgi-frame's outer edge. The extra
         specificity here (3 classes) is deliberate: it must outrank
         ".cgi-board > div" a few rules up, which would otherwise force this
         back to display:block. */
      .${instClass} .cgi-board .cgi-icons {
        position: absolute;
        inset: 0;
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        grid-template-rows: repeat(8, 1fr);
        pointer-events: none;
        z-index: 2;
      }
      .${instClass} .cgi-icon {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .${instClass} .cgi-icon svg {
        /* One square is --cgi-square / 8; size the icon as a fraction of that
           square, not of the whole board. cqmin can't be used here - it always
           resolves against the top-level .instClass container (the only size
           container in this tree), never against an individual grid cell. */
        width: calc(var(--cgi-inner) / 8 * 0.72);
        height: calc(var(--cgi-inner) / 8 * 0.72);
        filter: drop-shadow(0 1px 1px rgba(0,0,0,0.35));
      }
      /* 100% 100%, never "cover": cover crops the 8x8 image when the board is
         even a pixel off square, which slides the painted squares out of line
         with the real ones. */
      .${instClass} cg-board {
        background-image: ${boardUrl};
        background-color: ${theme.light};
        background-size: 100% 100%;
        background-repeat: no-repeat;
        background-position: center;
      }
      ${pieceCss}
      .${instClass} cg-board square.last-move { background-color: ${HIGHLIGHTS.lastMove}66; }
      .${instClass} cg-board square.selected  { background-color: ${HIGHLIGHTS.selected}66; }
      .${instClass} cg-board square.move-dest {
        background: radial-gradient(${HIGHLIGHTS.legal}88 22%, transparent 23%);
      }
      .${instClass} cg-board square.oc.move-dest {
        background: radial-gradient(transparent 0%, transparent 74%, ${HIGHLIGHTS.legal}88 75%);
      }
      .${instClass} cg-board square.check {
        background: radial-gradient(ellipse at center, ${HIGHLIGHTS.check}E6 0%, ${HIGHLIGHTS.check}59 55%, transparent 80%);
      }
      .${instClass} cg-board square.current-premove { background-color: ${HIGHLIGHTS.selected}66; }
      .${instClass} cg-board { --coord-weight: 600; }
      .${instClass} coords { font-size: 13px; font-weight: 600; opacity: 0.8; }
      ${pieceShadows ? `.${instClass} piece { filter: drop-shadow(0 3px 2px rgba(0,0,0,0.45)); }` : ""}
      ${moveTrails ? `
        @keyframes cgi-trail { from { box-shadow: inset 0 0 0 9999px ${HIGHLIGHTS.lastMove}55; } to { box-shadow: inset 0 0 0 9999px transparent; } }
        .${instClass} cg-board square.last-move { animation: cgi-trail 0.6s ease-out; }
      ` : ""}
      .${instClass} piece { will-change: transform; }
      /* Piece move animation - MICRO_INTERACTIONS_AND_INTEGRATIONS.md §2.1.
         A dragged piece must track the cursor with zero lag, so exclude it. */
      .${instClass} cg-board piece:not(.dragging) {
        transition: transform ${pieceTransitionMs}ms cubic-bezier(0.25, 0.1, 0.25, 1);
      }
    `;
  }, [boardTheme, pieceSet, pieceShadows, moveTrails, pieceTransitionMs, instClass]);

  // File letters / rank numbers, ordered for the current orientation.
  const files = orientation === "white"
    ? ["a", "b", "c", "d", "e", "f", "g", "h"]
    : ["h", "g", "f", "e", "d", "c", "b", "a"];
  const ranks = orientation === "white"
    ? ["8", "7", "6", "5", "4", "3", "2", "1"]
    : ["1", "2", "3", "4", "5", "6", "7", "8"];

  const board = <div ref={el} style={{ width: "100%", height: "100%", display: "block" }} />;

  // The frame is always drawn, so the board never resizes when coordinates are
  // toggled. Only the labels in the margin come and go.
  return (
    <div
      ref={wrapRef}
      style={{ width: "100%", height: "100%", position: "relative" }}
      className={blindfold ? `${instClass} blindfold` : instClass}
    >
      <style>{styleCss}</style>
      {/* cgi-ranks/cgi-files are siblings of cgi-frame, not children of it -
          both absolutely positioned against instClass. If they nested inside
          cgi-frame, their `left`/`top` would resolve against cgi-frame's OWN
          box (which itself starts one gutter in from instClass's edge), not
          against the container the gutter math was written for - putting
          ranks on top of the board's own left edge and shifting files one
          gutter-width past the board's right edge (both measured live). */}
      <div className="cgi-ranks">
        {coordinates && ranks.map((r) => <span key={r}>{r}</span>)}
      </div>
      <div className="cgi-frame">
        <div className="cgi-board">
          {board}
          <div className="cgi-icons">
            {ranks.map((r) => files.map((f) => {
              const sq = `${f}${r}`;
              return icons[sq] ? (
                <span key={sq} className="cgi-icon"
                  style={{ gridColumn: files.indexOf(f) + 1, gridRow: ranks.indexOf(r) + 1 }}>
                  <GamifiedIcon id={icons[sq]} />
                </span>
              ) : null;
            }))}
          </div>
        </div>
      </div>
      <div className="cgi-files">
        {coordinates && files.map((f) => <span key={f}>{f}</span>)}
      </div>
    </div>
  );
});

export const ChessBoard = memo(ChessBoardImpl);
