import { useCallback, useEffect, useState } from "react";
import type { LiveSummary } from "../types/liveState";

interface TimeRange {
  earliest_ms: number;
  latest_ms: number;
}

export function useTimeTravel() {
  const [mode, setMode] = useState<"live" | "replay">("live");
  const [replayTs, setReplayTs] = useState(Date.now());
  const [replayData, setReplayData] = useState<LiveSummary | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch time range on mount
  useEffect(() => {
    const fetchRange = async () => {
      try {
        const res = await fetch("/api/live/time-range");
        if (!res.ok) return;
        const data = (await res.json()) as TimeRange;
        setTimeRange(data);
      } catch {
        // Endpoint may not exist
      }
    };
    void fetchRange();
    const interval = setInterval(fetchRange, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch snapshot when in replay mode
  useEffect(() => {
    if (mode !== "replay") return;
    let cancelled = false;

    const fetchSnapshot = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/live/snapshot?at_ms=${replayTs}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as LiveSummary;
        if (!cancelled) setReplayData(data);
      } catch {
        // Snapshot endpoint may not exist
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchSnapshot();
    return () => { cancelled = true; };
  }, [mode, replayTs]);

  const goLive = useCallback(() => {
    setMode("live");
    setReplayData(null);
  }, []);

  const enterReplay = useCallback((ts: number) => {
    setMode("replay");
    setReplayTs(ts);
  }, []);

  return {
    mode,
    replayTs,
    setReplayTs: enterReplay,
    goLive,
    replayData,
    timeRange,
    loading,
  };
}
