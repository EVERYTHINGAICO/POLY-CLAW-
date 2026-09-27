import { useEffect, useState } from "react";

interface LatencyEdge {
  source: string;
  target: string;
  avg_duration_ms: number;
  p99_duration_ms: number;
}

export function useLatencyData(enabled: boolean) {
  const [latencyMap, setLatencyMap] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (!enabled) {
      setLatencyMap(new Map());
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch("/api/traces/latency");
        if (!res.ok) return;
        const data = (await res.json()) as { edges: LatencyEdge[] };
        if (cancelled) return;

        const map = new Map<string, number>();
        for (const edge of data.edges) {
          map.set(`${edge.source}→${edge.target}`, edge.avg_duration_ms);
        }
        setLatencyMap(map);
      } catch {
        // Latency endpoint may not be available
      }
    };

    void poll();
    const interval = setInterval(poll, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [enabled]);

  return { latencyMap };
}
