"use client";
import { useRef, useCallback } from "react";
import { soundForMove, type SoundType } from "@/lib/chess-pure";

export { soundForMove };
export type { SoundType };

/* Web Audio synthesized sound engine - original audio (no proprietary files,
 * MASTER-REPORT §12.5). Full WorldChess cue set (§10.7): move, capture, check,
 * castle, promotion, illegal, game-end, low-time tick. */

interface SoundConfig {
  freq: number;
  duration: number;
  type: OscillatorType;
  volume: number;
  extra?: { freq: number; delay: number; duration: number }[];
}

const SOUNDS: Record<SoundType, SoundConfig> = {
  move:      { freq: 900,  duration: 0.07, type: "square",   volume: 0.12 },
  capture:   { freq: 300,  duration: 0.14, type: "sawtooth", volume: 0.20, extra: [{ freq: 220, delay: 0.02, duration: 0.10 }] },
  check:     { freq: 1100, duration: 0.10, type: "sine",     volume: 0.25, extra: [{ freq: 1320, delay: 0.06, duration: 0.12 }] },
  castle:    { freq: 660,  duration: 0.09, type: "sine",     volume: 0.18, extra: [{ freq: 880, delay: 0.10, duration: 0.09 }] },
  promote:   { freq: 523,  duration: 0.12, type: "sine",     volume: 0.22, extra: [
    { freq: 659,  delay: 0.08, duration: 0.12 },
    { freq: 784,  delay: 0.16, duration: 0.12 },
    { freq: 1047, delay: 0.24, duration: 0.18 },
  ]},
  illegal:   { freq: 200,  duration: 0.10, type: "square",   volume: 0.15, extra: [{ freq: 180, delay: 0.05, duration: 0.08 }] },
  "game-end": { freq: 784, duration: 0.16, type: "sine",     volume: 0.24, extra: [
    { freq: 659, delay: 0.14, duration: 0.16 },
    { freq: 523, delay: 0.28, duration: 0.30 },
  ]},
  "low-time": { freq: 1500, duration: 0.05, type: "square",  volume: 0.10 },
};

function playTone(ctx: AudioContext, freq: number, duration: number, type: OscillatorType, volume: number, when = 0) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const start = ctx.currentTime + when;
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.01);
}

export function useChessSounds(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  function getCtx() {
    if (!ctxRef.current || ctxRef.current.state === "closed") {
      ctxRef.current = new AudioContext();
    }
    if (ctxRef.current.state === "suspended") ctxRef.current.resume();
    return ctxRef.current;
  }

  const play = useCallback((sound: SoundType) => {
    if (!enabledRef.current) return;
    try {
      const ctx = getCtx();
      const cfg = SOUNDS[sound];
      playTone(ctx, cfg.freq, cfg.duration, cfg.type, cfg.volume);
      for (const ex of cfg.extra ?? []) {
        playTone(ctx, ex.freq, ex.duration, cfg.type, cfg.volume * 0.8, ex.delay);
      }
    } catch {
      // AudioContext unavailable (SSR)
    }
  }, []);

  return { play };
}
