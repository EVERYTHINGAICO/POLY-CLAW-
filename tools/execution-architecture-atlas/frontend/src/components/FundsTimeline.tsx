import { useEffect, useState } from "react";
import type { FundsEntry } from "../types/liveState";

interface Props {
  width?: number;
  height?: number;
}

export function FundsTimeline({ width = 280, height = 60 }: Props) {
  const [entries, setEntries] = useState<FundsEntry[]>([]);

  useEffect(() => {
    let mounted = true;

    const fetchEntries = async () => {
      try {
        const response = await fetch("/api/live/funds-history?limit=50");
        if (!response.ok) return;
        const payload = (await response.json()) as { status: string; entries: FundsEntry[] };
        if (mounted && payload.entries) {
          setEntries(payload.entries.reverse());
        }
      } catch {
        // silently ignore
      }
    };

    void fetchEntries();
    const timer = setInterval(() => void fetchEntries(), 5000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);

  if (entries.length < 2) {
    return (
      <div className="funds-timeline" style={{ color: "var(--text-soft)", fontSize: "0.78rem" }}>
        No funds history available
      </div>
    );
  }

  const values = entries.map((e) => e.total_balance);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  const padX = 4;
  const padY = 6;
  const chartW = width - padX * 2;
  const chartH = height - padY * 2;

  const points = values
    .map((v, i) => {
      const x = padX + (i / (values.length - 1)) * chartW;
      const y = padY + chartH - ((v - minVal) / range) * chartH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const last = values[values.length - 1] ?? 0;
  const first = values[0] ?? 0;
  const trend = last >= first;

  return (
    <div className="funds-timeline">
      <div className="funds-timeline-header">
        <span style={{ fontSize: "0.72rem", color: "var(--text-soft)" }}>Balance History</span>
        <span style={{ fontSize: "0.72rem", color: trend ? "#86efac" : "#fca5a5" }}>
          ${last.toFixed(0)}
        </span>
      </div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <polyline
          points={points}
          fill="none"
          stroke={trend ? "#22c55e" : "#ef4444"}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
