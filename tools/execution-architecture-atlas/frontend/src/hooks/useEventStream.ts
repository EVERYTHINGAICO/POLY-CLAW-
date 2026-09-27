import { useEffect, useRef, useState } from "react";
import type { SystemEvent } from "../types/liveState";

interface EventStreamResult {
  events: SystemEvent[];
}

export function useEventStream(intervalMs = 3000): EventStreamResult {
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const latestTsRef = useRef(Date.now() - 5 * 60 * 1000); // start 5 min ago

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    const poll = async () => {
      try {
        const response = await fetch(
          `/api/live/events?since_ms=${latestTsRef.current}&limit=50`,
          { signal: controller.signal },
        );
        if (!response.ok) return;
        const payload = (await response.json()) as { status: string; events: SystemEvent[] };
        if (!mounted || !payload.events) return;

        if (payload.events.length > 0) {
          const maxTs = Math.max(...payload.events.map((e) => e.ts_ms));
          if (maxTs > latestTsRef.current) latestTsRef.current = maxTs + 1;
        }

        setEvents((prev) => {
          const merged = [...payload.events, ...prev];
          // Deduplicate by id+ts_ms and keep most recent 200
          const seen = new Set<string>();
          const unique = merged.filter((e) => {
            const key = `${e.id}-${e.ts_ms}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          return unique.slice(0, 200);
        });
      } catch {
        // silently ignore
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), intervalMs);
    return () => {
      mounted = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [intervalMs]);

  return { events };
}
