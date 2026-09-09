"use client";

/* A draw-over-anything canvas, like a Zoom whiteboard. Sits on top of the
 * board; only takes clicks while it is open. Plain canvas, no libraries.
 * Synced over the classroom's existing realtime channel (use-classroom-
 * channel.ts) - one more event type on the connection everyone already
 * has open, not a new channel/connection per participant. */

import { useEffect, useRef, useState, useCallback, useImperativeHandle } from "react";
import type { Ref } from "react";
import { Pen, Highlighter, Trash2, X, Users } from "lucide-react";
import type { WhiteboardEvent } from "@/hooks/use-classroom-channel";

type Tool = "pen" | "marker";

/** How often a stroke in progress may go out over the channel.
 *
 *  Pointer events fire once per frame or faster, and every one of them used
 *  to be its own Realtime broadcast. At a hundred-plus messages a second that
 *  saturates the socket for everyone in the class and makes each receiver do
 *  a hundred rounds of React work per second of drawing. Twenty points a
 *  second is more than a hand can outrun; the local canvas is still drawn at
 *  full pointer rate, so the person holding the pen sees no difference. */
const SEND_MS = 50;

/** Lets the parent hand incoming strokes straight to the canvas.
 *
 *  This exists so remote drawing never becomes React state. It used to: each
 *  arriving point called setState on the classroom, re-rendering the board,
 *  chat, roster and tab strip a hundred times a second while a coach drew a
 *  single circle. Canvas drawing is imperative anyway - the points have no
 *  business in a render tree. */
export type WhiteboardHandle = { apply: (e: WhiteboardEvent) => void };

function strokeStyle(tool: Tool, ctx: CanvasRenderingContext2D) {
  if (tool === "marker") { ctx.strokeStyle = "rgba(250, 204, 21, 0.45)"; ctx.lineWidth = 18; }
  else { ctx.strokeStyle = "#EF4444"; ctx.lineWidth = 3; }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

export function Whiteboard({
  open, onClose, canDraw, myUserId, onSend, studentPermission, ref,
}: {
  open: boolean;
  onClose: () => void;
  /** false = receive-and-render only (no pointer handlers, no toolbar) */
  canDraw: boolean;
  myUserId: string;
  onSend: (e: WhiteboardEvent) => void;
  /** coach-only: lets them open the floor to every student at once */
  studentPermission?: { allowed: boolean; onToggle: () => void };
  /** parent pushes incoming strokes in through this - see WhiteboardHandle */
  ref?: Ref<WhiteboardHandle>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [tool, setTool] = useState<Tool>("pen");
  const toolRef = useRef(tool);
  toolRef.current = tool;

  // Keep the canvas pixel size matched to its box so lines aren't stretched.
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const r = canvas.getBoundingClientRect();
      const prev = canvas.toDataURL();
      canvas.width = r.width;
      canvas.height = r.height;
      const img = new Image();
      img.onload = () => canvas.getContext("2d")?.drawImage(img, 0, 0, r.width, r.height);
      img.src = prev;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [open]);

  function pos(e: React.PointerEvent) {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  const draw = useCallback((kind: "down" | "move", nx: number, ny: number, t: Tool) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const x = nx * canvas.width, y = ny * canvas.height;
    if (kind === "down") { ctx.beginPath(); ctx.moveTo(x, y); return; }
    strokeStyle(t, ctx);
    ctx.lineTo(x, y);
    ctx.stroke();
  }, []);

  // The most recent point not yet broadcast, and when we last broadcast one.
  const pending = useRef<{ x: number; y: number } | null>(null);
  const lastSentAt = useRef(0);

  function flush() {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    lastSentAt.current = Date.now();
    onSend({ kind: "move", from: myUserId, x: p.x, y: p.y, tool: toolRef.current });
  }

  function down(e: React.PointerEvent) {
    if (!canDraw) return;
    drawing.current = true;
    pending.current = null;
    lastSentAt.current = Date.now();
    const p = pos(e);
    draw("down", p.x, p.y, toolRef.current);
    onSend({ kind: "down", from: myUserId, x: p.x, y: p.y, tool: toolRef.current });
  }
  function move(e: React.PointerEvent) {
    if (!canDraw || !drawing.current) return;
    const p = pos(e);
    draw("move", p.x, p.y, toolRef.current); // local canvas: every point, always
    pending.current = p;
    if (Date.now() - lastSentAt.current >= SEND_MS) flush();
  }
  function up() {
    if (!canDraw || !drawing.current) return;
    drawing.current = false;
    flush(); // the end of a stroke is never the point to drop
    onSend({ kind: "up", from: myUserId });
  }

  function clear(broadcast = true) {
    const c = canvasRef.current;
    if (c) c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    if (broadcast) onSend({ kind: "clear", from: myUserId });
  }

  /* Replay whatever the last participant (coach or a granted student) sent,
   * straight onto the canvas. Called by the parent's channel handler, not
   * driven by a prop, so an inbound stroke costs one canvas op and zero
   * renders. "up"/"open"/"close" carry no drawing - open/close are the
   * parent's business. */
  useImperativeHandle(ref, () => ({
    apply(e: WhiteboardEvent) {
      if (e.from === myUserId) return;
      if (e.kind === "down" || e.kind === "move") draw(e.kind, e.x, e.y, e.tool);
      else if (e.kind === "clear") {
        const c = canvasRef.current;
        c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
      }
    },
  }), [draw, myUserId]);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-20">
      <canvas
        ref={canvasRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        className={`absolute inset-0 w-full h-full touch-none ${canDraw ? "cursor-crosshair" : "cursor-default"}`}
      />
      {!canDraw && (
        <span className="absolute top-2 left-2 text-[11px] bg-black/40 text-white/90 rounded px-2 py-1">
          Watching the whiteboard
        </span>
      )}
      {canDraw && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-surface-1 border border-border rounded-full shadow-lg px-1.5 py-1">
          <ToolBtn active={tool === "pen"} onClick={() => setTool("pen")} title="Pen"><Pen size={16} /></ToolBtn>
          <ToolBtn active={tool === "marker"} onClick={() => setTool("marker")} title="Highlighter"><Highlighter size={16} /></ToolBtn>
          <span className="w-px h-5 bg-border mx-0.5" />
          {studentPermission && (
            <>
              <ToolBtn
                active={studentPermission.allowed}
                onClick={studentPermission.onToggle}
                title={studentPermission.allowed ? "Students can draw: click to lock" : "Only you can draw: click to let students draw"}
              >
                <Users size={16} />
              </ToolBtn>
              <span className="w-px h-5 bg-border mx-0.5" />
            </>
          )}
          <ToolBtn onClick={() => clear()} title="Clear all"><Trash2 size={16} /></ToolBtn>
          <ToolBtn onClick={onClose} title="Close whiteboard"><X size={16} /></ToolBtn>
        </div>
      )}
    </div>
  );
}

function ToolBtn({ active, onClick, title, children }: {
  active?: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
        active ? "bg-primary text-primary-foreground" : "hover:bg-surface-3 text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
