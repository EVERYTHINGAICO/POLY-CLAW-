import { useEffect, useRef } from "react";
import type { LiveSummary } from "../types/liveState";

export function useVoiceReadout(
  enabled: boolean,
  verbosity: "critical" | "all",
  liveData: LiveSummary | null,
) {
  const prevRef = useRef<LiveSummary | null>(null);

  useEffect(() => {
    if (!enabled || !liveData || liveData.status !== "ok") {
      prevRef.current = liveData;
      return;
    }

    const prev = prevRef.current;
    prevRef.current = liveData;

    if (!prev || prev.status !== "ok") return;

    const messages: Array<{ text: string; priority: number }> = [];

    // Kill switch activation
    if (!prev.authority.kill_switch_active && liveData.authority.kill_switch_active) {
      messages.push({ text: "ALERT. Kill switch activated. All execution halted.", priority: 0 });
    }

    // DLQ new entries
    if (liveData.dlq.count > prev.dlq.count) {
      const delta = liveData.dlq.count - prev.dlq.count;
      messages.push({ text: `Warning. ${delta} new dead letter queue ${delta === 1 ? "entry" : "entries"} detected.`, priority: 1 });
    }

    // Failed intents
    if (liveData.intents.failed > prev.intents.failed) {
      messages.push({ text: "Notice. Intent execution failed.", priority: 2 });
    }

    // Safe mode toggle
    if (!prev.authority.safe_mode_enabled && liveData.authority.safe_mode_enabled) {
      messages.push({ text: "Safe mode enabled.", priority: 1 });
    } else if (prev.authority.safe_mode_enabled && !liveData.authority.safe_mode_enabled) {
      messages.push({ text: "Safe mode disabled.", priority: 1 });
    }

    // Fills (all mode only)
    if (verbosity === "all") {
      const newFills = liveData.orders.recent_fills.filter(
        (f) => !prev.orders.recent_fills.some((pf) => pf.fill_id === f.fill_id),
      );
      for (const fill of newFills.slice(0, 2)) {
        messages.push({
          text: `Fill confirmed. ${fill.side} ${fill.size} at ${fill.price.toFixed(2)}.`,
          priority: 3,
        });
      }
    }

    if (messages.length === 0) return;

    // Sort by priority (lower = more urgent)
    messages.sort((a, b) => a.priority - b.priority);

    // Speak the most important message
    try {
      if (!window.speechSynthesis) return;

      // Cancel any queued speech for critical messages
      if (messages[0]!.priority <= 1) {
        window.speechSynthesis.cancel();
      }

      const utterance = new SpeechSynthesisUtterance(messages[0]!.text);
      utterance.rate = 1.0;
      utterance.pitch = 0.9;
      utterance.volume = 0.8;

      // Try to pick a professional voice
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(
        (v) => v.name.includes("UK English Male") || v.name.includes("Daniel") || v.name.includes("Google UK English Male"),
      );
      if (preferred) utterance.voice = preferred;

      window.speechSynthesis.speak(utterance);
    } catch {
      // Speech synthesis not available
    }
  }, [enabled, verbosity, liveData]);
}
