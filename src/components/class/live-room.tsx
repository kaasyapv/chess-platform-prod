"use client";

/* Classroom video, on self-hosted LiveKit.
 *
 * Replaces the raw WebRTC mesh that used to live in video-room.tsx. The mesh
 * was O(n²) streams and needed its own TURN credentials and signalling over the
 * Supabase channel; LiveKit is an SFU, so each participant publishes once and
 * the server fans out. Self-hosted (NEXT_PUBLIC_LIVEKIT_URL), so there is no
 * per-minute vendor bill - see Clone_reference/Live_class details/recreation-code/
 * livekit-integration.md §0.
 *
 * LAYOUT CONTRACT (this is the part that kept breaking):
 * The rail is a FIXED height box. It never flex-grows, and the tiles inside it
 * scroll rather than expand. A video grid that sizes itself to its content will
 * happily take height from its siblings - and the sibling here is the
 * chessboard, whose square-to-pixel maths must not be perturbed by however many
 * cameras happen to be on. So: fixed height in, scroll inside, board untouched.
 */

import "@livekit/components-styles";
import { useEffect, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  ControlBar,
  ParticipantTile,
  useTracks,
  useRoomContext,
} from "@livekit/components-react";
import { Track } from "livekit-client";

/** Height of the camera rail. Fixed on purpose - see the layout contract above. */
const RAIL_HEIGHT = 200;

type TokenResponse = { token: string; url: string; isCoach: boolean };

export function LiveRoom({ classroomId }: { classroomId: string }) {
  const [auth, setAuth] = useState<TokenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/livekit/token?classroom=${encodeURIComponent(classroomId)}`);
        const body = await res.json();
        if (cancelled) return;
        // 503 = the server has no LiveKit keys. Not a fault, just not set up:
        // show calm placeholder tiles, never an error wall.
        if (res.status === 503) { setUnconfigured(true); return; }
        if (!res.ok) { setError(body.error ?? "Could not join the video room"); return; }
        setAuth(body);
      } catch {
        if (!cancelled) setError("Could not reach the video service");
      }
    })();
    return () => { cancelled = true; };
  }, [classroomId]);

  if (unconfigured) return <PlaceholderRail />;

  if (error) {
    return (
      <div className="h-full bg-surface-1 border border-border rounded-card flex flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="text-sm font-medium">Video unavailable</p>
        <p className="text-xs text-muted-foreground max-w-xs">{error}</p>
      </div>
    );
  }

  if (!auth) {
    return (
      <div className="h-full bg-surface-1 border border-border rounded-card flex items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Connecting to the class…</p>
      </div>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={auth.url}
      token={auth.token}
      connect
      // Everyone lands muted with the camera off, as in the reference product:
      // a class of thirty auto-publishing cameras is nobody's idea of a lesson.
      audio={false}
      video={false}
      // adaptiveStream downgrades tiles nobody is looking at; dynacast stops
      // publishing layers no one subscribes to. Both cut CPU on the coach's box.
      options={{ adaptiveStream: true, dynacast: true }}
      className="h-full flex flex-col bg-surface-1 border border-border rounded-card overflow-hidden"
    >
      <CameraRail />
      <RoomAudioRenderer />
      <div className="border-t border-border shrink-0 [&_.lk-button]:!p-3.5 [&_.lk-button]:!rounded-full [&_.lk-button_svg]:!w-6 [&_.lk-button_svg]:!h-6">
        <ControlBar
          variation="minimal"
          controls={{ camera: true, microphone: true, screenShare: true, chat: false, leave: true }}
        />
      </div>
    </LiveKitRoom>
  );
}

/**
 * Shown when the server has no LiveKit keys: the same rail geometry as the real
 * grid, but with quiet camera-off tiles. The class works fine without video and
 * this space should say so - not shout "unavailable".
 */
function PlaceholderRail() {
  return (
    <div className="h-full flex flex-col bg-surface-1 border border-border rounded-card overflow-hidden">
      {/* grid-cols-2, confirmed against the live reference's own camera grid
          (.grid.grid-cols-2.gap-2.p-2.h-full on their lk-participant-tile
          ancestor) - a fixed 2-column grid, not auto-fill, and tiles take
          whatever height the row gives them rather than a forced 16:9 box. */}
      <div className="shrink-0 p-2" style={{ height: RAIL_HEIGHT, minHeight: 0 }}>
        <div className="grid grid-cols-2 gap-2 h-full" style={{ gridAutoRows: "minmax(0, 1fr)" }}>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i}
              className="rounded-lg bg-surface-2 border border-border flex flex-col items-center justify-center gap-1.5 min-h-0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                className="text-muted-foreground/60" aria-hidden>
                <path d="M15 7a2 2 0 012 2v1l4-2v8l-4-2v1a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2z" />
                <path d="M2 2l20 20" />
              </svg>
              <span className="text-[10px] text-muted-foreground/70">Camera off</span>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-border shrink-0 px-3 py-2">
        <p className="text-xs text-muted-foreground">
          Video streaming is currently offline.
        </p>
      </div>
    </div>
  );
}

/**
 * The tile grid. `shrink-0` + an explicit height is what stops it stealing space
 * from the board when a third or fourth camera comes on: new tiles wrap and the
 * rail scrolls, the rail does not grow.
 */
function CameraRail() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  const room = useRoomContext();

  return (
    <div
      className="shrink-0 overflow-y-auto p-2"
      style={{ height: RAIL_HEIGHT }}
      aria-label={`${tracks.length} participants`}
    >
      {tracks.length === 0 ? (
        <div className="h-full flex items-center justify-center">
          <p className="text-xs text-muted-foreground">
            Waiting for {room.name ? "the class" : "participants"}…
          </p>
        </div>
      ) : (
        // grid-cols-2, matching the reference's own camera grid (see PlaceholderRail).
        <div className="grid grid-cols-2 gap-2 h-full" style={{ gridAutoRows: "minmax(0, 1fr)" }}>
          {tracks.map((track) => (
            <ParticipantTile
              key={`${track.participant.identity}-${track.source}`}
              trackRef={track}
              className="rounded-lg overflow-hidden bg-neutral-900 min-h-0"
            />
          ))}
        </div>
      )}
    </div>
  );
}
