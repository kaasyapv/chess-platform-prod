"use client";

/* Floating / docked classroom video.
 * Spec: final_boss_implement/deep_dive_micro_features/MICRO_INTERACTIONS_AND_INTEGRATIONS.md §2 (PiP)
 *
 * The one <MeshVideoRoom> for a session is mounted HERE, in a provider that
 * lives in the dashboard layout — above the Next router — so navigating away
 * from /classrooms/{id} does not unmount it and drop every peer connection.
 *
 * CRITICAL: <MeshVideoRoom> is rendered in exactly ONE place in this tree (a
 * single always-`position:fixed` box). React would unmount + remount it — and
 * kill every RTCPeerConnection — if it moved between JSX positions or between
 * `createPortal` targets. So instead of portaling, the box just RESTYLES:
 *  - docked  : positioned over <VideoDockSlot>'s rect in the classroom panel
 *  - floating : a 320×214 card, header-draggable, edge-snapped
 *  - hidden  : mounted but off-screen (on the owning route before the slot
 *              mounts, or while the panel shows the quiz screen)
 *
 * `popOut` (a separate window) is not built — it needs a second connection. */

import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState,
} from "react";
import { usePathname } from "next/navigation";
import { GripHorizontal, Maximize2, PhoneOff } from "lucide-react";
import { MeshVideoRoom } from "@/components/class/mesh-video-room";

type Me = { userId: string; name: string; role: string };
type Session = { classroomId: string; me: Me; devices?: { micId?: string; camId?: string } };

type DockCtx = {
  session: Session | null;
  start: (s: Session) => void;
  stop: () => void;
  registerSlot: (el: HTMLElement | null) => void;
  isLive: (classroomId: string) => boolean;
};

const Ctx = createContext<DockCtx | null>(null);

export function useVideoDock() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useVideoDock outside <VideoDockProvider>");
  return c;
}

/** Reserves the in-panel space for the video and reports where it is. The
 *  actual <MeshVideoRoom> is positioned over this by the provider. */
export function VideoDockSlot({ className }: { className?: string }) {
  const { registerSlot } = useVideoDock();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    registerSlot(ref.current);
    return () => registerSlot(null);
  }, [registerSlot]);
  return <div ref={ref} className={className} style={{ height: "100%" }} />;
}

const FLOAT_W = 320;
const FLOAT_H = 214;
const HEADER_H = 28;
const MARGIN = 16;

type Rect = { left: number; top: number; width: number; height: number };

export function VideoDockProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [slotRect, setSlotRect] = useState<Rect | null>(null);
  const pathname = usePathname();

  const registerSlot = useCallback((el: HTMLElement | null) => { setSlot(el); if (!el) setSlotRect(null); }, []);
  const start = useCallback((s: Session) => setSession(s), []);
  const stop = useCallback(() => setSession(null), []);
  const isLive = useCallback((id: string) => session?.classroomId === id, [session]);

  const onOwningRoute = !!session && pathname.includes(`/classrooms/${session.classroomId}`);
  const docked = onOwningRoute && !!slotRect;

  // Track the slot's viewport rect: it moves when the panel resizes, the
  // divider is dragged, or the main content scrolls.
  useLayoutEffect(() => {
    if (!slot) return;
    const read = () => {
      const r = slot.getBoundingClientRect();
      setSlotRect((prev) =>
        prev && prev.left === r.left && prev.top === r.top && prev.width === r.width && prev.height === r.height
          ? prev
          : { left: r.left, top: r.top, width: r.width, height: r.height });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(slot);
    window.addEventListener("scroll", read, { capture: true, passive: true });
    window.addEventListener("resize", read);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", read, { capture: true });
      window.removeEventListener("resize", read);
    };
  }, [slot]);

  // Floating position, bottom-right by default, draggable, edge-snapped.
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const place = () => setPos((p) =>
      p.x === 0 && p.y === 0
        ? { x: window.innerWidth - FLOAT_W - MARGIN, y: window.innerHeight - FLOAT_H - MARGIN }
        : {
            x: Math.min(p.x, window.innerWidth - FLOAT_W - MARGIN),
            y: Math.min(p.y, window.innerHeight - FLOAT_H - MARGIN),
          });
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);

  const onDragHandle = (e: React.PointerEvent) => {
    e.preventDefault();
    const from = { x: e.clientX, y: e.clientY };
    const origin = { ...pos };
    const move = (ev: PointerEvent) => {
      setPos({
        x: Math.max(MARGIN, Math.min(window.innerWidth - FLOAT_W - MARGIN, origin.x + ev.clientX - from.x)),
        y: Math.max(MARGIN, Math.min(window.innerHeight - FLOAT_H - MARGIN, origin.y + ev.clientY - from.y)),
      });
    };
    const up = () => {
      setPos((p) => ({
        ...p,
        x: p.x + FLOAT_W / 2 < window.innerWidth / 2 ? MARGIN : window.innerWidth - FLOAT_W - MARGIN,
      }));
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // The single box style. `hidden` = mounted but out of the way.
  let boxStyle: React.CSSProperties;
  let showHeader = false;
  if (docked && slotRect) {
    boxStyle = { left: slotRect.left, top: slotRect.top, width: slotRect.width, height: slotRect.height, borderRadius: 0, border: "none", boxShadow: "none" };
  } else if (onOwningRoute) {
    // owning route, slot not mounted yet / quiz screen showing: keep alive, hide
    boxStyle = { left: -9999, top: -9999, width: FLOAT_W, height: FLOAT_H, visibility: "hidden" };
  } else {
    boxStyle = { left: pos.x, top: pos.y, width: FLOAT_W, height: FLOAT_H };
    showHeader = true;
  }

  return (
    <Ctx.Provider value={{ session, start, stop, registerSlot, isLive }}>
      {children}
      {session && (
        <div
          className="fixed z-[70] overflow-hidden rounded-[14px] border border-border bg-surface-1 shadow-pop"
          style={boxStyle}
        >
          {showHeader && (
            <div
              onPointerDown={onDragHandle}
              className="flex cursor-grab items-center gap-1.5 bg-surface-2 px-2 text-[11px] font-medium active:cursor-grabbing"
              style={{ height: HEADER_H }}
            >
              <GripHorizontal size={13} className="text-muted-foreground" />
              <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-live" /> Classroom video</span>
              <span className="flex-1" />
              <a href={pathnameToClassroom(session.classroomId, pathname)} title="Back to class"
                className="grid h-5 w-5 place-items-center rounded hover:bg-surface-3">
                <Maximize2 size={12} />
              </a>
              <button onClick={stop} title="Leave call" className="grid h-5 w-5 place-items-center rounded text-destructive hover:bg-destructive/10">
                <PhoneOff size={12} />
              </button>
            </div>
          )}
          <div style={{ height: showHeader ? FLOAT_H - HEADER_H : "100%" }}>
            <MeshVideoRoom classroomId={session.classroomId} me={session.me} devices={session.devices} />
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

/** Best-effort link back to the classroom. The float only appears once the user
 *  has been on that route, so the role/academy segments are in `pathname`. */
function pathnameToClassroom(classroomId: string, pathname: string): string {
  const m = pathname.match(/^\/([^/]+)\/dashboard\/([^/]+)\//);
  return m ? `/${m[1]}/dashboard/${m[2]}/classrooms/${classroomId}` : "#";
}
