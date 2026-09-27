import { useEffect, useRef } from "react";
import type { LiveSummary } from "../types/liveState";

function playTone(ctx: AudioContext, freq: number, duration: number, type: OscillatorType) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.12, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

export function useAudioAlerts(enabled: boolean, data: LiveSummary | null) {
  const prevRef = useRef<LiveSummary | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!enabled || !data || data.status !== "ok") {
      prevRef.current = data;
      return;
    }

    const prev = prevRef.current;
    prevRef.current = data;
    if (!prev || prev.status !== "ok") return;

    // Lazy-init AudioContext (requires prior user gesture — toggle button click counts)
    if (!ctxRef.current) {
      try {
        ctxRef.current = new AudioContext();
      } catch {
        return;
      }
    }
    const ctx = ctxRef.current;

    // Priority order: most severe first
    if (data.authority.kill_switch_active && !prev.authority.kill_switch_active) {
      // Kill switch — alarm: two rapid low tones
      playTone(ctx, 180, 0.4, "sawtooth");
      setTimeout(() => playTone(ctx, 140, 0.5, "sawtooth"), 200);
    } else if (data.dlq.count > prev.dlq.count) {
      // DLQ entry — low warning
      playTone(ctx, 220, 0.3, "sawtooth");
    } else if (data.intents.failed > prev.intents.failed) {
      // Failed intent — medium alert
      playTone(ctx, 330, 0.2, "triangle");
    } else if (data.orders.recent_fills.length > prev.orders.recent_fills.length) {
      // Fill — pleasant ping
      playTone(ctx, 660, 0.1, "sine");
    } else if (data.intents.done > prev.intents.done) {
      // Intent completed — subtle high ping
      playTone(ctx, 880, 0.08, "sine");
    }
  }, [enabled, data]);
}
