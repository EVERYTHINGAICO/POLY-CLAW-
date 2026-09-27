import { useEffect, useRef, useState } from "react";
import type { LiveSummary } from "../types/liveState";

export interface LiveStateResult {
  data: LiveSummary | null;
  isLive: boolean;
  lastUpdated: number;
}

export function useLiveState(intervalMs = 2000): LiveStateResult {
  const [data, setData] = useState<LiveSummary | null>(null);
  const [lastUpdated, setLastUpdated] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let mounted = true;

    const poll = async () => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      try {
        const response = await fetch("/api/live/summary", {
          signal: controller.signal,
        });

        if (!response.ok || !mounted) return;

        const payload = (await response.json()) as LiveSummary;
        if (mounted) {
          setData(payload);
          setLastUpdated(Date.now());
        }
      } catch {
        // Silently ignore — polling will retry
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), intervalMs);

    return () => {
      mounted = false;
      controllerRef.current?.abort();
      clearInterval(timer);
    };
  }, [intervalMs]);

  const isLive = data?.status === "ok" && Date.now() - lastUpdated < intervalMs * 3;

  return { data, isLive, lastUpdated };
}
