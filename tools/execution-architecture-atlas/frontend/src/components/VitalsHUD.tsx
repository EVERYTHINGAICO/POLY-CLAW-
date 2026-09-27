import { useEffect, useRef, useState } from "react";
import type { LiveSummary } from "../types/liveState";

interface Props {
  liveData: LiveSummary | null;
  visible: boolean;
}

interface Sample {
  done: number;
  ts: number;
}

function formatUptime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function VitalsHUD({ liveData, visible }: Props) {
  const startTsRef = useRef<number | null>(null);
  const samplesRef = useRef<Sample[]>([]);
  const [uptime, setUptime] = useState("--");
  const [intentRate, setIntentRate] = useState("--");
  const [fillRate, setFillRate] = useState("--");
  const [utilPct, setUtilPct] = useState("--");

  // Track uptime from first data point
  useEffect(() => {
    if (!liveData || liveData.status !== "ok") return;

    if (startTsRef.current === null) {
      startTsRef.current = liveData.timestamp_ms;
    }
  }, [liveData]);

  // Update uptime every second
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => {
      if (startTsRef.current !== null) {
        setUptime(formatUptime(Date.now() - startTsRef.current));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [visible]);

  // Compute derived metrics when data changes
  useEffect(() => {
    if (!liveData || liveData.status !== "ok") return;

    // Intents/sec — rolling window
    const now = Date.now();
    samplesRef.current.push({ done: liveData.intents.done, ts: now });
    // Keep last 10 samples
    if (samplesRef.current.length > 10) {
      samplesRef.current = samplesRef.current.slice(-10);
    }

    const samples = samplesRef.current;
    if (samples.length >= 2) {
      const oldest = samples[0]!;
      const newest = samples[samples.length - 1]!;
      const deltaTime = (newest.ts - oldest.ts) / 1000;
      const deltaDone = newest.done - oldest.done;
      if (deltaTime > 0 && deltaDone >= 0) {
        const rate = deltaDone / deltaTime;
        setIntentRate(rate < 0.01 ? "0" : rate.toFixed(1));
      }
    }

    // Fill rate
    const fills = liveData.orders.recent_fills.length;
    setFillRate(fills.toString());

    // Capital utilization
    const { total_balance, locked_balance, reserved_balance } = liveData.capital;
    if (total_balance > 0) {
      const pct = ((locked_balance + reserved_balance) / total_balance) * 100;
      setUtilPct(`${pct.toFixed(0)}%`);
    } else {
      setUtilPct("--");
    }
  }, [liveData]);

  if (!visible) return null;

  return (
    <div className="vitals-hud">
      <div className="vitals-card">
        <span className="vitals-label">Uptime</span>
        <span className="vitals-value">{uptime}</span>
      </div>
      <div className="vitals-card">
        <span className="vitals-label">Intents/sec</span>
        <span className="vitals-value">{intentRate}</span>
      </div>
      <div className="vitals-card">
        <span className="vitals-label">Recent Fills</span>
        <span className="vitals-value">{fillRate}</span>
      </div>
      <div className="vitals-card">
        <span className="vitals-label">Capital Used</span>
        <span className={`vitals-value${Number.parseInt(utilPct) > 80 ? " warn" : ""}`}>{utilPct}</span>
      </div>
    </div>
  );
}
