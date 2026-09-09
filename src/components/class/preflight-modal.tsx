"use client";

/* Device pre-flight — "Start classroom video".
 * Spec: final_boss_implement/deep_dive_micro_features/MICRO_INTERACTIONS_AND_INTEGRATIONS.md §1.1-1.3
 *
 * Shown once per classroom (sessionStorage) before the mesh video room mounts,
 * so the coach/student picks a mic + camera + speaker and sees a live mic level
 * before the call opens for everyone. The level meter is Web Audio peak
 * amplitude driven by requestAnimationFrame — no <canvas>, a CSS scaleX bar.
 *
 * This modal holds its own getUserMedia stream ONLY while open; it tears the
 * stream + AudioContext down on Start/Cancel/unmount so MeshVideoRoom can
 * acquire the same devices cleanly afterwards. */

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, Volume2 } from "lucide-react";
import { Button, Select } from "@/components/ui";
import { peakLevel } from "@/lib/av-meter";

export type PreflightDevices = { micId?: string; camId?: string; speakerId?: string };

const STORE_KEY = "classroom-av-devices";

/** Remembered device choice (localStorage). Used to prime MeshVideoRoom's
 *  getUserMedia so a reload lands back in the call with the same devices. */
export function loadPreflightDevices(): PreflightDevices {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as PreflightDevices) : {};
  } catch {
    return {};
  }
}
function savePreflightDevices(d: PreflightDevices) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch { /* private mode */ }
}

/** True once the pre-flight has been completed for this classroom this session. */
export function preflightDone(classroomId: string): boolean {
  try { return sessionStorage.getItem(`preflight:${classroomId}`) === "1"; } catch { return false; }
}
function markPreflightDone(classroomId: string) {
  try { sessionStorage.setItem(`preflight:${classroomId}`, "1"); } catch { /* private mode */ }
}

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  autoGainControl: true,
  echoCancellation: true,
  noiseSuppression: true,
  // newer constraint; ignored where unsupported
  ...({ voiceIsolation: true } as MediaTrackConstraints),
};

export function PreflightModal({
  open, classroomId, onCancel, onStart,
}: {
  open: boolean;
  classroomId: string;
  onCancel: () => void;
  onStart: (devices: PreflightDevices) => void;
}) {
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState(() => loadPreflightDevices().micId ?? "");
  const [camId, setCamId] = useState(() => loadPreflightDevices().camId ?? "");
  const [speakerId, setSpeakerId] = useState(() => loadPreflightDevices().speakerId ?? "");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const videoEl = useRef<HTMLVideoElement>(null);
  const testAudio = useRef<HTMLAudioElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = useRef(0);

  const teardown = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    srcRef.current?.disconnect();
    srcRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLevel(0);
  }, []);

  // (Re)acquire the preview stream whenever the modal is open or a toggle /
  // device selection changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      teardown();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: micOn ? { deviceId: micId ? { exact: micId } : undefined, ...AUDIO_CONSTRAINTS } : false,
          video: camOn ? { deviceId: camId ? { exact: camId } : undefined } : false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        setError(null);

        if (videoEl.current) videoEl.current.srcObject = camOn ? stream : null;

        // Device labels are only populated after a getUserMedia grant.
        setDevices(await navigator.mediaDevices.enumerateDevices());

        const audioTrack = stream.getAudioTracks()[0];
        if (micOn && audioTrack) {
          const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ctx = new Ctx();
          audioCtxRef.current = ctx;
          const src = ctx.createMediaStreamSource(stream);
          srcRef.current = src;
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 2048;
          src.connect(analyser); // NOT connected to ctx.destination — no monitoring feedback
          const bufA = new Uint8Array(analyser.fftSize);
          const tick = () => {
            analyser.getByteTimeDomainData(bufA);
            setLevel(peakLevel(bufA));
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not access your devices");
      }
    })();

    return () => { cancelled = true; teardown(); };
  }, [open, micOn, camOn, micId, camId, teardown]);

  // Re-enumerate on plug/unplug.
  useEffect(() => {
    if (!open) return;
    const onChange = () => navigator.mediaDevices.enumerateDevices().then(setDevices);
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onChange);
  }, [open]);

  if (!open) return null;

  const mics = devices.filter((d) => d.kind === "audioinput");
  const cams = devices.filter((d) => d.kind === "videoinput");
  const speakers = devices.filter((d) => d.kind === "audiooutput");

  const start = () => {
    const chosen: PreflightDevices = { micId: micId || undefined, camId: camId || undefined, speakerId: speakerId || undefined };
    savePreflightDevices(chosen);
    markPreflightDone(classroomId);
    teardown();
    onStart(chosen);
  };

  const testSpeaker = async () => {
    const el = testAudio.current;
    if (!el) return;
    try {
      if (speakerId && "setSinkId" in el) {
        await (el as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(speakerId);
      }
      el.currentTime = 0;
      await el.play();
    } catch { /* autoplay / sinkId unsupported */ }
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-scrim/50 p-4" role="dialog" aria-modal="true" aria-label="Start classroom video">
      <div className="pop flex w-full max-w-[448px] flex-col overflow-hidden rounded-[10px] bg-surface-1 shadow-pop">
        <div className="px-5 pt-5">
          <h2 className="text-base font-semibold">Start classroom video</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Choose your microphone and camera before starting the call.</p>
        </div>

        <div className="px-5 pt-4">
          <div className="relative aspect-[390/202] w-full overflow-hidden rounded-[10px] bg-black">
            <video ref={videoEl} autoPlay muted playsInline className="h-full w-full object-cover" />
            {!camOn && (
              <p className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-white/70">
                Turn on camera to preview your video.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 p-5">
          {/* Mic row: toggle + device + live level */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMicOn((v) => !v)}
              aria-pressed={micOn}
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors ${micOn ? "bg-[#3C83F6] text-white" : "bg-surface-3 text-muted-foreground"}`}
            >
              {micOn ? <Mic size={16} /> : <MicOff size={16} />}
            </button>
            <Select className="min-w-0 flex-1 text-sm" value={micId} onChange={(e) => setMicId(e.target.value)} disabled={!micOn}>
              <option value="">{mics.length ? "System default" : "No microphones found"}</option>
              {mics.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone"}</option>)}
            </Select>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full origin-left rounded-full bg-[#3C83F6]"
              style={{ transform: `scaleX(${micOn ? Math.min(1, level * 1.4) : 0})` }}
            />
          </div>

          {/* Camera row */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCamOn((v) => !v)}
              aria-pressed={camOn}
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors ${camOn ? "bg-[#3C83F6] text-white" : "bg-surface-3 text-muted-foreground"}`}
            >
              {camOn ? <Video size={16} /> : <VideoOff size={16} />}
            </button>
            <Select className="min-w-0 flex-1 text-sm" value={camId} onChange={(e) => setCamId(e.target.value)} disabled={!camOn}>
              <option value="">{cams.length ? "System default" : "No cameras found"}</option>
              {cams.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Camera"}</option>)}
            </Select>
          </div>

          {/* Speaker row */}
          <div className="flex items-center gap-2">
            <button onClick={testSpeaker} title="Play a test tone" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-3 text-muted-foreground transition-colors hover:text-foreground">
              <Volume2 size={16} />
            </button>
            <Select className="min-w-0 flex-1 text-sm" value={speakerId} onChange={(e) => setSpeakerId(e.target.value)}>
              <option value="">{speakers.length ? "System default" : "System default"}</option>
              {speakers.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Speaker"}</option>)}
            </Select>
            <audio ref={testAudio} src="/sounds/move.mp3" preload="none" />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { teardown(); onCancel(); }}>Cancel</Button>
            <Button onClick={start}>Start video</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
