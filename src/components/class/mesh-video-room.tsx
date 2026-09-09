"use client";

/* Classroom video, P2P mesh over STUN with a TURN relay fallback - no
 * LiveKit, no VPS.
 *
 * ponytail: this is the same shape of thing live-room.tsx replaced 11 days ago
 * (see commit 9a9b0a2) because raw mesh is O(n²) streams and needs TURN for
 * strict NATs. It's back as the classroom's default video, for groups small
 * enough (<=MAX_PEERS) that mesh is genuinely fine and "no server to run"
 * matters more than NAT robustness. live-room.tsx (LiveKit) is kept in the
 * repo, unreferenced, as the one-file swap back if that stops being true.
 *
 * The "no relay, accepted limitation" note that used to sit here is gone
 * because the decision changed: STUN-only meant two participants on different
 * networks routinely could not connect at all, which is not a limitation, it
 * is the feature not working. ICE_SERVERS below now always carries a TURN
 * entry. Note what that does and does not buy: a relayed pair no longer
 * exposes each side's IP to the other, but any pair that still connects
 * directly (same LAN, friendly NAT - the common and desirable case) does,
 * visible via chrome://webrtc-internals or getStats(). Forcing every pair
 * through the relay would close that too, at the cost of putting all class
 * media through one relay; not done, and iceTransportPolicy: "relay" is the
 * one-word change if that trade ever flips.
 *
 * Signaling: a Supabase Realtime channel per classroom carries only SDP
 * offers/answers and ICE candidates, each addressed with `to`/`from` so peers
 * ignore signals not meant for them. Exactly one side of each pair sends the
 * offer, picked deterministically in the presence-join handler below - that
 * fixed direction is what avoids two peers racing to both send offers at once
 * (glare) without needing perfect-negotiation bookkeeping.
 */

import { useEffect, useRef, useState, useCallback, memo } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Mic, MicOff, Video, VideoOff, ScreenShare, MonitorOff, Pin, PinOff, Grid2x2, Hand, ChevronLeft, ChevronRight, PhoneOff, Eye } from "lucide-react";
import {
  scoreQuality, sampleFromStats, QUALITY_LABEL, QUALITY_COLOR, QUALITY_BARS,
  type Quality, type NetSample, type RawReport,
} from "@/lib/net-quality";
import { dicebearUrl } from "@/lib/dicebear";
import { shouldOffer } from "@/lib/mesh-signaling";

const MAX_PEERS = 8;
const GRID_PAGE_SIZE = 4;
/* STUN alone tells each peer its public address, which is enough only when at
 * least one side's NAT lets an unsolicited packet back in. Two participants on
 * different home or office networks - the cross-network test that failed - are
 * routinely both behind symmetric NAT or an outbound-only firewall, and then
 * neither side's candidates can reach the other and the connection dies with
 * no error beyond an ICE state of "failed". Only a relay fixes that, because a
 * relay is a server both sides can reach outbound.
 *
 * So a TURN entry is always present now, never conditional on env. Set
 * NEXT_PUBLIC_TURN_URLS/_USERNAME/_CREDENTIAL and it uses your relay; unset,
 * it falls back to the free public openrelay endpoints so a class on two
 * networks works out of the box.
 *
 * ponytail: the public relay is best-effort, shared, and not something to run
 * a business on - it is a floor, not a plan. Provision a real TURN (coturn,
 * Cloudflare Calls, metered.ca, Twilio) and set the env vars; nothing else
 * here has to change. Port 443 over TCP is listed last on purpose: it is the
 * slowest path but the one that survives firewalls that block UDP outright. */
const TURN_URLS = process.env.NEXT_PUBLIC_TURN_URLS?.split(",").filter(Boolean);
const ICE_SERVERS: RTCIceServer[] = [
  {
    urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
      "stun:stun2.l.google.com:19302",
    ],
  },
  TURN_URLS?.length
    ? {
        urls: TURN_URLS,
        username: process.env.NEXT_PUBLIC_TURN_USERNAME,
        credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
      }
    : {
        urls: [
          "turn:openrelay.metered.ca:80",
          "turn:openrelay.metered.ca:443",
          "turn:openrelay.metered.ca:443?transport=tcp",
        ],
        username: "openrelayproject",
        credential: "openrelayproject",
      },
];

type Signal =
  | { type: "offer" | "answer"; to: string; from: string; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; to: string; from: string; candidate: RTCIceCandidateInit };

type Me = { userId: string; name: string; role: string };

function MeshVideoRoomImpl({ classroomId, me, viewOnly = false, devices }: {
  classroomId: string; me: Me; viewOnly?: boolean;
  /* Devices chosen in the pre-flight modal. Applied at join time (mesh has no
   * in-call device switcher); a later change means re-mounting the room. */
  devices?: { micId?: string; camId?: string };
}) {
  const configured = !!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remotes, setRemotes] = useState<Record<string, MediaStream>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [roles, setRoles] = useState<Record<string, string>>({}); // presence-reported role, picks the avatar style
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [sharing, setSharing] = useState(false);
  const [full, setFull] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Purely a layout choice - not read by the signaling effect below, so
  // pinning/unpinning never touches an RTCPeerConnection.
  const [pinnedPeerId, setPinnedPeerId] = useState<string | null>(null);
  const [handOn, setHandOn] = useState(false);
  const [raisedHands, setRaisedHands] = useState<Record<string, boolean>>({});
  const [gridPage, setGridPage] = useState(0);
  const [left, setLeft] = useState(false); // hung up on purpose - stays off until Rejoin
  const [joined, setJoined] = useState(false); // viewOnly: no localStream, so this is the "ready" signal instead
  // Per-peer connection quality, sampled from each RTCPeerConnection's own
  // getStats() every NET_POLL_MS. Keyed by peer id; the local tile reports the
  // worst of our outbound links, since that's what our peers are experiencing.
  const [netQuality, setNetQuality] = useState<Record<string, Quality>>({});
  const [netDetail, setNetDetail] = useState<Record<string, NetSample>>({});
  const statsCursorRef = useRef<Record<string, Parameters<typeof sampleFromStats>[1]>>({});

  const channelRef = useRef<RealtimeChannel | null>(null);
  const pcsRef = useRef<Record<string, RTCPeerConnection>>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  // Only used when a remote description arrives without an msid, so
  // `ontrack` has no ready-made stream to hand the <video> element.
  const remoteStreamsRef = useRef<Record<string, MediaStream>>({});
  /* ICE candidates that arrived before the peer had a remote description.
   *
   * addIceCandidate throws until setRemoteDescription has run, and the old
   * code swallowed that throw - so any candidate that overtook its own
   * offer/answer was discarded for good. On one LAN that is survivable,
   * because the host candidate everybody keeps is usually the one that wins.
   * Across two networks the candidates that matter are exactly the late ones
   * (server-reflexive, then relay), and losing a couple of them is the
   * difference between a connection and a permanent black tile. Hold them
   * until the description lands, then replay them in order. */
  const pendingIceRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  // The webcam track, kept alive (but possibly unsent) so screen share has
  // something to revert to. currentVideoTrackRef is whichever of the two
  // (camera or screen) is actually going out over the peer connections -
  // new peers who join mid-share attach to that one, not blindly to the camera.
  const cameraVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const currentVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  // Same idea for audio: the mic track to revert to, and whichever audio
  // (mic, or the tab/system audio the share picker returned) is live now.
  // Screen share audio is optional - most pickers only return it for a
  // shared tab, not a whole screen - so this stays the mic track unless one shows up.
  const micAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const currentAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  const closePeer = useCallback((peerId: string) => {
    pcsRef.current[peerId]?.close();
    delete pcsRef.current[peerId];
    delete remoteStreamsRef.current[peerId];
    delete pendingIceRef.current[peerId];
    // Drop this peer's stats baseline too, or a rejoin would diff against
    // counters from the previous session and report a bogus loss spike.
    delete statsCursorRef.current[peerId];
    setRemotes((r) => {
      const rest = { ...r };
      delete rest[peerId];
      return rest;
    });
    setNetQuality((q) => {
      const rest = { ...q };
      delete rest[peerId];
      return rest;
    });
    setNetDetail((d) => {
      const rest = { ...d };
      delete rest[peerId];
      return rest;
    });
    setRoles((r) => {
      const rest = { ...r };
      delete rest[peerId];
      return rest;
    });
  }, []);

  const getOrCreatePeer = useCallback((peerId: string) => {
    let pc = pcsRef.current[peerId];
    if (pc) return pc;

    /* iceCandidatePoolSize pre-gathers a candidate before the offer is even
     * built, which matters most on the relay path: allocating a TURN
     * candidate is a round trip to the relay, and doing it up front takes it
     * off the critical path between "someone joined" and "video appears". */
    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 2 });
    pcsRef.current[peerId] = pc;

    // Whichever audio/video is live right now (mic/camera, or screen if already sharing).
    if (currentAudioTrackRef.current) pc.addTrack(currentAudioTrackRef.current, localStreamRef.current!);
    if (currentVideoTrackRef.current) pc.addTrack(currentVideoTrackRef.current, localStreamRef.current!);
    /* Camera off right now, but we still publish: reserve the video m-line
     * anyway. Without a sender to replaceTrack into, anyone who joins during
     * a camera-off stretch would negotiate an audio-only connection and stay
     * audio-only for the rest of the class, however many times the camera
     * came back on. viewOnly peers publish nothing and reserve nothing - an
     * offerless, m-line-less spectator is the whole point. */
    else if (!viewOnly) pc.addTransceiver("video", { direction: "sendrecv" });

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "ice", to: peerId, from: me.userId, candidate: e.candidate.toJSON() } satisfies Signal,
      });
    };

    /* Every remote track - audio and video alike - lands in one MediaStream
     * per peer, which is what the tile's <video> gets as srcObject. The
     * sender always calls addTrack(track, stream), so e.streams[0] is
     * normally there; the fallback covers a remote description that carries
     * no msid, where relying on e.streams[0] alone would leave a peer that is
     * plainly sending video rendering as a black rectangle. */
    pc.ontrack = (e) => {
      let stream = e.streams[0];
      if (!stream) {
        stream = remoteStreamsRef.current[peerId] ??= new MediaStream();
        if (!stream.getTrackById(e.track.id)) stream.addTrack(e.track);
      }
      setRemotes((r) => (r[peerId] === stream ? r : { ...r, [peerId]: stream }));
    };

    pc.onconnectionstatechange = () => {
      if (pc!.connectionState === "failed") {
        /* ICE gave up: this pair has no usable path (typically strict NAT with
         * no TURN configured). That's the class breaking for this participant,
         * so it's the trigger for the fallback chain - the server decides
         * whether it turns into a WhatsApp message, and dedupes the burst that
         * arrives when several peers fail at once. Fire and forget: if this
         * request fails too, we're already in the failure path. */
        void fetch("/api/failures/classroom", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            classroomId,
            kind: "webrtc_failure",
            detail: `peer connection to ${peerId} failed (ICE could not establish a path)`,
          }),
        }).catch(() => {});
      }
      if (pc!.connectionState === "failed" || pc!.connectionState === "closed") closePeer(peerId);
    };

    return pc;
  }, [me.userId, closePeer, classroomId, viewOnly]);

  useEffect(() => {
    if (!configured || left) return;

    let cancelled = false;
    const supabase = createClient();
    const channel = supabase.channel(`mesh-video:${classroomId}`, {
      // Authorized server-side by RLS on realtime.messages (classroom
      // membership) - see 0032_realtime_classroom_authorization.sql.
      config: { broadcast: { self: false }, presence: { key: me.userId }, private: true },
    });
    channelRef.current = channel;

    channel.on("broadcast", { event: "signal" }, async ({ payload }) => {
      const signal = payload as Signal;
      if (signal.to !== me.userId) return;

      // One malformed or out-of-order signal must not take the handler down
      // with it - an uncaught throw in here means every later signal from
      // every other peer goes unanswered too.
      // Replay whatever arrived while this peer had no remote description yet.
      const flushIce = async (peerId: string, pc: RTCPeerConnection) => {
        const queued = pendingIceRef.current[peerId];
        if (!queued?.length) return;
        delete pendingIceRef.current[peerId];
        for (const c of queued) await pc.addIceCandidate(c).catch(() => {});
      };

      try {
        if (signal.type === "offer") {
          setNames((n) => ({ ...n, [signal.from]: n[signal.from] ?? "Participant" }));
          const pc = getOrCreatePeer(signal.from);
          await pc.setRemoteDescription(signal.sdp);
          await flushIce(signal.from, pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          channel.send({
            type: "broadcast",
            event: "signal",
            payload: { type: "answer", to: signal.from, from: me.userId, sdp: answer } satisfies Signal,
          });
        } else if (signal.type === "answer") {
          const pc = pcsRef.current[signal.from];
          // Ignore an answer that no longer matches our state (a duplicate, or
          // one that lost a race we already resolved) instead of throwing.
          if (pc?.signalingState === "have-local-offer") {
            await pc.setRemoteDescription(signal.sdp);
            await flushIce(signal.from, pc);
          }
        } else if (signal.type === "ice") {
          const pc = pcsRef.current[signal.from];
          // No peer yet, or no remote description yet: queue rather than drop.
          if (pc?.remoteDescription) await pc.addIceCandidate(signal.candidate).catch(() => {});
          else (pendingIceRef.current[signal.from] ??= []).push(signal.candidate);
        }
      } catch (err) {
        console.warn("mesh signal ignored:", signal.type, err);
      }
    });

    channel.on("presence", { event: "join" }, async ({ key: peerId, newPresences }) => {
      if (!peerId || peerId === me.userId) return;
      const meta = (newPresences as { name?: string; role?: string; viewOnly?: boolean }[])[0];
      setNames((n) => ({ ...n, [peerId]: meta?.name ?? "Participant" }));
      if (meta?.role) setRoles((r) => ({ ...r, [peerId]: meta.role! }));

      /* Exactly one side of a pair may offer - see shouldOffer for why the
       * old "whoever was already here calls the newcomer" rule fired on both
       * sides at once, and why that left every Live Ops tile black. */
      if (!shouldOffer(me.userId, peerId, { meViewOnly: viewOnly, peerViewOnly: meta?.viewOnly })) return;

      const pc = getOrCreatePeer(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      channel.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "offer", to: peerId, from: me.userId, sdp: offer } satisfies Signal,
      });
    });

    channel.on("broadcast", { event: "hand" }, ({ payload }) => {
      const { userId, raised } = payload as { userId: string; raised: boolean };
      setRaisedHands((h) => ({ ...h, [userId]: raised }));
    });

    channel.on("presence", { event: "leave" }, ({ key: peerId }) => {
      if (peerId) closePeer(peerId);
      setRaisedHands((h) => {
        const rest = { ...h };
        delete rest[peerId];
        return rest;
      });
    });

    (async () => {
      try {
        /* Camera FIRST, subscribe second.
         *
         * The presence-join handler above answers "someone new arrived" by
         * calling getOrCreatePeer(), which attaches whatever is in
         * currentVideo/AudioTrackRef at that instant. Subscribing before
         * getUserMedia meant those refs were still null for the seconds the
         * browser's permission prompt was open, so anyone who joined during
         * that window got an offer carrying no tracks at all - and since a
         * peer is only ever offered to once, on their presence join, that
         * connection stayed empty for the rest of the class. The newcomer's
         * own tracks still reached us, which is exactly the reported shape:
         * "I can see them, they can't see me." Media is ready before we are
         * listening, so there is no window left to lose an offer in.
         *
         * viewOnly peers publish nothing by design and so have nothing to
         * wait for. */
        if (!viewOnly) {
          // Tablet-friendly: low-res/low-fps camera keeps mesh CPU/bandwidth
          // sane at up to MAX_PEERS connections on weaker hardware.
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: devices?.camId ? { ideal: devices.camId } : undefined,
              width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 },
            },
            audio: devices?.micId ? { deviceId: { ideal: devices.micId } } : true,
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          localStreamRef.current = stream;
          cameraVideoTrackRef.current = stream.getVideoTracks()[0] ?? null;
          currentVideoTrackRef.current = cameraVideoTrackRef.current;
          micAudioTrackRef.current = stream.getAudioTracks()[0] ?? null;
          currentAudioTrackRef.current = micAudioTrackRef.current;
          setLocalStream(stream);
          /* Fresh devices are live, so the buttons say live. Rejoining after
           * a hang-up used to keep whatever mute state was set before, which
           * left a red "muted" mic button sitting over a microphone that was
           * actually recording - the inverted-button report, and the worse
           * half of it. */
          setMicOn(true);
          setCamOn(true);
        }

        /* subscribe() returns the channel, not a promise, so awaiting it used
         * to fall straight through: track() went out before the channel had
         * joined and a channel that failed to authorize looked identical to a
         * healthy one. Resolve on the real status instead. */
        /* The signaling channel is `private: true`, so the join is checked
         * against RLS on realtime.messages and needs the user's JWT in the
         * join payload. subscribe() reads that token synchronously from a
         * value the socket fills in asynchronously, so a first subscribe can
         * race it and join unauthenticated. Resolve it first. */
        await supabase.realtime.setAuth();
        await new Promise<void>((resolve, reject) => {
          channel.subscribe((status, err) => {
            if (status === "SUBSCRIBED") resolve();
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              reject(err ?? new Error(status));
            }
          });
        });
        if (cancelled) return;
        const state = channel.presenceState<{ name: string }>();
        const already = Object.keys(state).filter((k) => k !== me.userId);
        if (already.length >= MAX_PEERS) {
          // Give the camera back rather than holding the light on behind a
          // "room is full" screen.
          localStreamRef.current?.getTracks().forEach((t) => t.stop());
          localStreamRef.current = null;
          if (!cancelled) { setLocalStream(null); setFull(true); }
          return;
        }
        // viewOnly: existing participants still see the presence join and
        // offer their tracks to us; getOrCreatePeer never calls addTrack on
        // our side, so the answer negotiates receive-only automatically.
        await channel.track({ name: me.name, role: me.role, ...(viewOnly ? { viewOnly: true } : {}) });
        if (!cancelled) setJoined(true);
      } catch (err) {
        if (cancelled) return;
        // A spectator never opens a camera, so its only failure mode is the
        // signaling channel - saying "camera/microphone" there sent people
        // hunting for a permission prompt that was never going to appear.
        setError(viewOnly || localStreamRef.current
          ? "Could not connect to this classroom's video."
          : "Could not access camera/microphone.");
        console.warn("mesh join failed:", err);
      }
    })();

    return () => {
      cancelled = true;
      const pcs = pcsRef.current;
      Object.keys(pcs).forEach(closePeer);
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId, me.userId, configured, left, viewOnly]);

  /* Network meters. One interval for the whole room - each tick walks the peer
   * connections we already hold and asks each for its own getStats(). No extra
   * connections, no per-tile timers: adding a 9th participant adds one more
   * getStats() call to an existing tick, not another polling loop.
   *
   * Cleanup is the same story as the connections themselves: closePeer drops
   * the entry, and the interval is cleared on unmount/leave below. */
  useEffect(() => {
    /* Skipped entirely for spectators. Live Ops holds several of these rooms
     * at once and shows no meters on them, so polling getStats() across every
     * peer of every card was pure background CPU on the one page least able
     * to spare it. */
    if (!joined || viewOnly) return;
    let cancelled = false;

    const tick = async () => {
      const entries = Object.entries(pcsRef.current);
      if (entries.length === 0) {
        if (!cancelled) { setNetQuality({}); setNetDetail({}); }
        return;
      }
      const nextQ: Record<string, Quality> = {};
      const nextD: Record<string, NetSample> = {};
      await Promise.all(entries.map(async ([peerId, pc]) => {
        try {
          const report = await pc.getStats();
          const raws: RawReport[] = [];
          report.forEach((r) => raws.push(r as unknown as RawReport));
          const { sample, cursor } = sampleFromStats(raws, statsCursorRef.current[peerId] ?? null);
          statsCursorRef.current[peerId] = cursor;
          nextQ[peerId] = scoreQuality(pc.connectionState, sample);
          nextD[peerId] = sample;
        } catch {
          nextQ[peerId] = "disconnected";
        }
      }));
      if (cancelled) return;
      // Our own tile shows the worst link we're serving - that's what the room
      // experiences of us, which is more useful than our loopback to ourselves.
      const order: Quality[] = ["excellent", "good", "fair", "poor", "reconnecting", "disconnected"];
      const mine = Object.values(nextQ).reduce<Quality | null>(
        (worst, q) => (worst == null || order.indexOf(q) > order.indexOf(worst) ? q : worst), null);
      if (mine) nextQ[me.userId] = mine;
      setNetQuality(nextQ);
      setNetDetail(nextD);
    };

    void tick();
    const id = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [joined, me.userId, viewOnly]);

  const toggleMic = () => {
    // Muting by `enabled` (not stop()) is deliberate for audio: unmuting has
    // to be instant mid-sentence, and re-acquiring a mic takes long enough to
    // clip the first word. The button is driven off the same value we write.
    const next = !micOn;
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
  };

  /* Camera off means the camera is actually off.
   *
   * enabled=false only blanks the frames - the device stays open, so macOS
   * keeps its green indicator lit and the browser keeps its recording dot,
   * and people reasonably read that as "this app is still watching me". The
   * fix is to stop the track and hand the device back.
   *
   * The sender stays in place with a null track, so turning the camera back
   * on is a replaceTrack into an already-negotiated m-line: no offer/answer
   * round trip, no renegotiation, no page refresh. */
  const [camBusy, setCamBusy] = useState(false);
  const toggleCam = async () => {
    if (camBusy) return;
    setCamBusy(true);
    try {
      if (camOn) {
        cameraVideoTrackRef.current?.stop();
        const stopped = cameraVideoTrackRef.current;
        cameraVideoTrackRef.current = null;
        if (stopped) localStreamRef.current?.removeTrack(stopped);
        // While screen sharing, the camera is not what peers are watching -
        // stop the device but leave the share going out untouched.
        if (!sharing) {
          currentVideoTrackRef.current = null;
          replaceOutgoingTrack("video", null);
        }
        setLocalStream(localStreamRef.current ? new MediaStream(localStreamRef.current.getTracks()) : null);
        setCamOn(false);
      } else {
        const cam = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: devices?.camId ? { ideal: devices.camId } : undefined,
            width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 },
          },
        });
        const track = cam.getVideoTracks()[0] ?? null;
        cameraVideoTrackRef.current = track;
        const stream = localStreamRef.current ?? new MediaStream();
        if (track) stream.addTrack(track);
        localStreamRef.current = stream;
        if (!sharing) {
          currentVideoTrackRef.current = track;
          replaceOutgoingTrack("video", track);
        }
        setLocalStream(new MediaStream(stream.getTracks()));
        setCamOn(true);
      }
    } catch (err) {
      // Device busy or permission withdrawn. Leaving the button red is the
      // honest state: the camera really is not on.
      console.warn("camera toggle failed:", err);
      setCamOn(false);
    } finally {
      setCamBusy(false);
    }
  };
  const toggleHand = () => {
    const raised = !handOn;
    setHandOn(raised);
    // broadcast is self:false, so we also set our own copy for the local tile.
    setRaisedHands((h) => ({ ...h, [me.userId]: raised }));
    channelRef.current?.send({
      type: "broadcast",
      event: "hand",
      payload: { userId: me.userId, raised },
    });
  };

  /* Matches on the transceiver, not on sender.track.kind. Once a track has
   * been replaced with null - which is what turning the camera off now does -
   * the sender reports no kind at all, so a sender-side match would never
   * find that slot again and the camera could never be turned back on. The
   * receiver's track keeps the kind for the life of the transceiver. */
  const replaceOutgoingTrack = (kind: "audio" | "video", track: MediaStreamTrack | null) => {
    Object.values(pcsRef.current).forEach((pc) => {
      pc.getTransceivers()
        .find((t) => (t.sender.track?.kind ?? t.receiver.track?.kind) === kind)
        ?.sender.replaceTrack(track)
        .catch(() => {}); // peer closed mid-toggle; nothing to recover
    });
  };

  const stopShare = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    currentVideoTrackRef.current = cameraVideoTrackRef.current;
    currentAudioTrackRef.current = micAudioTrackRef.current;
    replaceOutgoingTrack("video", cameraVideoTrackRef.current);
    replaceOutgoingTrack("audio", micAudioTrackRef.current);
    setScreenStream(null);
    setSharing(false);
  }, []);

  const toggleShare = async () => {
    if (sharing) { stopShare(); return; }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const track = stream.getVideoTracks()[0];
      screenStreamRef.current = stream;
      currentVideoTrackRef.current = track;
      replaceOutgoingTrack("video", track);
      // Covers the floating Chrome "Stop sharing" bar, not just our own button.
      track.onended = stopShare;

      // Not every share source yields audio (whole-screen usually doesn't,
      // a shared tab often does) - only swap the sender if one showed up.
      const screenAudioTrack = stream.getAudioTracks()[0];
      if (screenAudioTrack) {
        currentAudioTrackRef.current = screenAudioTrack;
        replaceOutgoingTrack("audio", screenAudioTrack);
        screenAudioTrack.onended = stopShare;
      }

      setScreenStream(stream);
      setSharing(true);
    } catch {
      // User dismissed the picker - nothing to report.
    }
  };

  if (left) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="text-sm font-medium">You left the call</p>
        <button
          onClick={() => setLeft(false)}
          className="rounded-btn bg-primary hover:bg-primary-hover text-primary-foreground px-4 py-2 text-sm font-medium"
        >
          Rejoin
        </button>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="h-full flex items-center justify-center p-4 text-center">
        <p className="text-sm text-muted-foreground">Video is not configured.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-4 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (full) {
    return (
      <div className="h-full flex items-center justify-center p-4 text-center">
        <p className="text-sm text-muted-foreground">This room is full ({MAX_PEERS} max for peer-to-peer video).</p>
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Connecting…</p>
      </div>
    );
  }

  const tiles = [
    ...(viewOnly || !localStream ? [] : [{ id: me.userId, stream: screenStream ?? localStream, name: `${me.name} (you)`, muted: true, mirrored: true, role: me.role }]),
    /* Live Ops joins receive-only (viewOnly) so a manager can watch every
     * room on the wall at once - unmuting each one would mean a dozen
     * classrooms' audio playing over each other in the background. Every
     * other tile still carries sound normally; only the silent-observer
     * mode is forced quiet. Never mirrored: a manager reading a board a
     * student is holding up needs the true orientation, not a flipped one. */
    ...Object.entries(remotes).map(([id, stream]) => ({
      id, stream, name: names[id] ?? "Participant", muted: viewOnly, mirrored: false, role: roles[id],
    })),
  ];

  // Falls back to the grid on its own if the pinned peer leaves - no
  // separate cleanup needed, tiles just stops containing that id.
  const pinnedTile = tiles.find((t) => t.id === pinnedPeerId) ?? null;
  const otherTiles = pinnedTile ? tiles.filter((t) => t.id !== pinnedTile.id) : tiles;

  // Grid mode shows exactly 4 at a time (a clean 2x2) instead of scrolling
  // through everyone - beyond 4, it snaps into pages of 4 via the arrows.
  const gridPageCount = Math.max(1, Math.ceil(tiles.length / GRID_PAGE_SIZE));
  const clampedGridPage = Math.min(gridPage, gridPageCount - 1);
  const pagedTiles = tiles.slice(clampedGridPage * GRID_PAGE_SIZE, clampedGridPage * GRID_PAGE_SIZE + GRID_PAGE_SIZE);

  return (
    <div
      className="h-full flex flex-col bg-surface-1 border border-border rounded-card overflow-hidden"
      title="Peer-to-peer video: connects directly between participants, no video server in between."
    >
      <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-2">
        {tiles.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No one has video on yet.</p>
          </div>
        ) : pinnedTile ? (
          <>
            <div className="flex-1 min-h-0">
              <VideoTile {...pinnedTile} pinned onPin={setPinnedPeerId} handRaised={!!raisedHands[pinnedTile.id]}
                quality={netQuality[pinnedTile.id]} sample={netDetail[pinnedTile.id]} />
            </div>
            {otherTiles.length > 0 && (
              <div className="shrink-0 flex gap-2 overflow-x-auto h-20">
                {otherTiles.map((t) => (
                  <div key={t.id} className="shrink-0 w-28 h-full">
                    <VideoTile {...t} onPin={setPinnedPeerId} handRaised={!!raisedHands[t.id]}
                      quality={netQuality[t.id]} sample={netDetail[t.id]} />
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {/* Fixed 2x2 - a 5th+ participant doesn't shrink the tiles, it
                moves to the next page instead. */}
            <div className="flex-1 min-h-0 grid grid-cols-2 gap-2" style={{ gridAutoRows: "minmax(0, 1fr)" }}>
              {pagedTiles.map((t) => (
                <VideoTile key={t.id} {...t} onPin={setPinnedPeerId} handRaised={!!raisedHands[t.id]}
                  quality={netQuality[t.id]} sample={netDetail[t.id]} />
              ))}
            </div>
            {gridPageCount > 1 && (
              <div className="shrink-0 flex items-center justify-center gap-3">
                <button
                  onClick={() => setGridPage((p) => Math.max(0, p - 1))}
                  disabled={clampedGridPage === 0}
                  className="inline-flex items-center justify-center rounded-btn p-1 bg-surface-2 hover:bg-surface-3 disabled:opacity-30 disabled:pointer-events-none"
                  aria-label="Previous 4"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {clampedGridPage + 1} / {gridPageCount}
                </span>
                <button
                  onClick={() => setGridPage((p) => Math.min(gridPageCount - 1, p + 1))}
                  disabled={clampedGridPage === gridPageCount - 1}
                  className="inline-flex items-center justify-center rounded-btn p-1 bg-surface-2 hover:bg-surface-3 disabled:opacity-30 disabled:pointer-events-none"
                  aria-label="Next 4"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
      <div className="border-t border-border shrink-0 flex items-center justify-center gap-3 p-3">
        {viewOnly ? (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Eye size={14} /> Watching only, participants can&apos;t see or hear you
          </p>
        ) : (
        <>
        {/* Google Meet's convention, which people already have in their hands:
            live is quiet (neutral, plain icon), muted/off shouts (solid red,
            slashed icon). Literal red rather than the destructive token -
            that token is a pale #f87171 in dark mode, and "your mic is off"
            is exactly the state that must not be easy to miss. */}
        <button
          onClick={toggleMic}
          aria-pressed={!micOn}
          className={`inline-flex items-center justify-center rounded-full p-3.5 transition-colors ${micOn ? "bg-surface-2 hover:bg-surface-3" : "bg-red-600 hover:bg-red-700 text-white"}`}
          aria-label={micOn ? "Mute" : "Unmute"}
          title={micOn ? "Mute microphone" : "Microphone is muted"}
        >
          {micOn ? <Mic size={24} /> : <MicOff size={24} />}
        </button>
        <button
          onClick={() => void toggleCam()}
          disabled={camBusy}
          aria-pressed={!camOn}
          className={`inline-flex items-center justify-center rounded-full p-3.5 transition-colors disabled:opacity-60 ${camOn ? "bg-surface-2 hover:bg-surface-3" : "bg-red-600 hover:bg-red-700 text-white"}`}
          aria-label={camOn ? "Turn camera off" : "Turn camera on"}
          title={camOn ? "Turn camera off" : "Camera is off"}
        >
          {camOn ? <Video size={24} /> : <VideoOff size={24} />}
        </button>
        <button
          onClick={toggleShare}
          className={`inline-flex items-center justify-center rounded-full p-3.5 ${sharing ? "bg-primary text-primary-foreground" : "bg-surface-2 hover:bg-surface-3"}`}
          aria-label={sharing ? "Stop sharing screen" : "Share screen"}
        >
          {sharing ? <MonitorOff size={24} /> : <ScreenShare size={24} />}
        </button>
        <button
          onClick={toggleHand}
          className={`inline-flex items-center justify-center rounded-full p-3.5 ${handOn ? "bg-primary text-primary-foreground" : "bg-surface-2 hover:bg-surface-3"}`}
          aria-label={handOn ? "Lower hand" : "Raise hand"}
        >
          <Hand size={24} />
        </button>
        <button
          onClick={() => { setPinnedPeerId(null); setGridPage(0); }}
          disabled={!pinnedTile}
          className={`inline-flex items-center justify-center rounded-full p-3.5 ${pinnedTile ? "bg-surface-2 hover:bg-surface-3" : "bg-surface-2 opacity-40 cursor-default"}`}
          aria-label="Grid view"
          title="Grid view: 4 at a time"
        >
          <Grid2x2 size={24} />
        </button>
        <button
          onClick={() => setLeft(true)}
          className="inline-flex items-center justify-center rounded-full p-3.5 bg-destructive text-destructive-foreground hover:opacity-90"
          aria-label="Leave call"
          title="Leave call"
        >
          <PhoneOff size={24} />
        </button>
        </>
        )}
      </div>
    </div>
  );
}

/* Memoised on the values it actually uses, not on prop identity.
 *
 * Every call site builds `me` inline - me={{ userId, name, role }} - so a
 * plain memo() would never hit. It has to hit: Live Ops re-renders the whole
 * wall each time any coach's live_fen lands, once per 1.5s per live class,
 * and a video room is the most expensive thing on that page to re-render.
 * Nothing here reads a function prop, so comparing these five values is the
 * whole contract. */
export const MeshVideoRoom = memo(MeshVideoRoomImpl, (a, b) =>
  a.classroomId === b.classroomId &&
  a.viewOnly === b.viewOnly &&
  a.me.userId === b.me.userId &&
  a.me.name === b.me.name &&
  a.me.role === b.me.role,
);

/** Signal-strength glyph + label, driven by real getStats() readings. */
function NetMeter({ quality, sample }: { quality: Quality; sample?: NetSample }) {
  const color = QUALITY_COLOR[quality];
  const bars = QUALITY_BARS[quality];
  const detail = sample
    ? [
        sample.rttMs != null ? `${Math.round(sample.rttMs)}ms RTT` : null,
        sample.loss != null ? `${(sample.loss * 100).toFixed(1)}% loss` : null,
        sample.jitterMs != null ? `${Math.round(sample.jitterMs)}ms jitter` : null,
        sample.kbps != null ? `${Math.round(sample.kbps)} kbps` : null,
      ].filter(Boolean).join(" · ")
    : "";
  return (
    <span
      className="absolute top-1 left-1.5 flex items-center gap-1 rounded bg-black/50 px-1.5 py-0.5"
      title={`${QUALITY_LABEL[quality]}${detail ? ` (${detail})` : ""}`}
      aria-label={`Connection ${QUALITY_LABEL[quality]}`}
    >
      <span className="flex items-end gap-[1.5px] h-3" aria-hidden>
        {[1, 2, 3, 4].map((n) => (
          <span
            key={n}
            className="w-[3px] rounded-[1px]"
            style={{
              height: `${n * 25}%`,
              background: n <= bars ? color : "rgba(255,255,255,0.25)",
            }}
          />
        ))}
      </span>
      {(quality === "reconnecting" || quality === "disconnected" || quality === "poor") && (
        <span className="text-[9px] font-medium" style={{ color }}>{QUALITY_LABEL[quality]}</span>
      )}
    </span>
  );
}

function VideoTile({
  id, stream, name, muted, mirrored, pinned, onPin, handRaised, quality, sample, role,
}: {
  id: string; stream: MediaStream; name: string; muted: boolean;
  /** Flip horizontally. Only the local self-preview should ever be true -
   *  it is what every video-call app does, since a person expects to see
   *  themselves the way a mirror shows them. Remote participants are always
   *  sent as recorded: mirroring someone else's stream would flip any text
   *  or board they hold up to the camera, which is wrong for every viewer
   *  watching it, including a manager on Live Ops. */
  mirrored?: boolean;
  pinned?: boolean; onPin?: (id: string | null) => void; handRaised?: boolean;
  quality?: Quality; sample?: NetSample; role?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  // Is anything actually arriving on this tile's video track right now?
  const [videoLive, setVideoLive] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    /* Set as a property, not left to the attribute: autoplay of a stream that
     * carries audio is only permitted while the element is muted, and a Live
     * Ops feed that silently refuses to start is indistinguishable from a
     * broken one. play() for the same reason - srcObject assigned after mount
     * does not always start on its own. */
    el.muted = muted;
    void el.play().catch(() => {});

    /* Turning a camera off stops the track, which is what hands the device
     * back to the OS - but it also leaves the last decoded frame frozen on
     * everyone else's screen, and a still of someone's face is a worse lie
     * than a black rectangle. A receiver reports its track muted when the
     * frames stop, so drop the <video> out of the way and let the avatar
     * underneath show through, the way Meet does. Also covers a peer whose
     * camera was already off when we connected.
     *
     * ponytail: relies on the browser's own mute detection, so the avatar can
     * take a second or two to replace the frozen frame. If that lag ever
     * matters, broadcast the camera state on the `hand` channel alongside it
     * and use this as the fallback. */
    const sync = () => {
      const track = stream.getVideoTracks()[0];
      setVideoLive(!!track && !track.muted && track.readyState === "live");
    };
    sync();

    const tracks = stream.getVideoTracks();
    const events = ["mute", "unmute", "ended"] as const;
    tracks.forEach((t) => events.forEach((e) => t.addEventListener(e, sync)));
    stream.addEventListener("addtrack", sync);
    stream.addEventListener("removetrack", sync);
    return () => {
      tracks.forEach((t) => events.forEach((e) => t.removeEventListener(e, sync)));
      stream.removeEventListener("addtrack", sync);
      stream.removeEventListener("removetrack", sync);
    };
  }, [stream, muted]);

  return (
    // h-full, not a fixed aspect-ratio box: the tile fills whatever space its
    // parent (grid cell, filmstrip slot, or the pinned area) gives it, so it
    // actually grows/shrinks when that parent is resized. object-cover on the
    // <video> absorbs the mismatch with the source's real aspect ratio.
    <div className="relative rounded-lg overflow-hidden bg-neutral-900 min-h-0 h-full">
      {/* The participant's avatar sits behind the video, so a camera-off tile
          shows who it is instead of a black rectangle. */}
      <img
        src={dicebearUrl(id, role, 96)} alt=""
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full opacity-90"
      />
      <video ref={ref} autoPlay playsInline muted={muted}
        className={`relative w-full h-full object-cover ${mirrored ? "-scale-x-100" : ""} ${videoLive ? "" : "opacity-0"}`} />
      {quality && <NetMeter quality={quality} sample={sample} />}
      {handRaised && (
        <span className={`absolute top-1 rounded-full bg-primary text-primary-foreground p-1 ${quality ? "left-16" : "left-1.5"}`}>
          <Hand size={11} />
        </span>
      )}
      <span className="absolute bottom-1 left-1.5 text-[10px] text-white/90 bg-black/40 rounded px-1.5 py-0.5">
        {name}
      </span>
      {onPin && (
        <button
          onClick={() => onPin(pinned ? null : id)}
          className="absolute top-1 right-1 p-1 rounded bg-black/40 hover:bg-black/60 text-white/90"
          aria-label={pinned ? "Unpin" : "Pin"}
        >
          {pinned ? <PinOff size={12} /> : <Pin size={12} />}
        </button>
      )}
    </div>
  );
}
