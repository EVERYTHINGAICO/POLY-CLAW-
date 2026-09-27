import { useEffect, useRef, useState } from "react";
import type { LiveSummary } from "../types/liveState";

interface AnomalyResult {
  hasAnomaly: boolean;
  anomalyType: "dlq" | "failure" | "kill_switch" | null;
}

export function useAnomalyDetector(data: LiveSummary | null): AnomalyResult {
  const prevRef = useRef<LiveSummary | null>(null);
  const [anomaly, setAnomaly] = useState<AnomalyResult>({ hasAnomaly: false, anomalyType: null });

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = data;

    if (!data || data.status !== "ok" || !prev || prev.status !== "ok") return;

    let detected: AnomalyResult["anomalyType"] = null;

    if (data.authority.kill_switch_active && !prev.authority.kill_switch_active) {
      detected = "kill_switch";
    } else if (data.dlq.count > prev.dlq.count) {
      detected = "dlq";
    } else if (data.intents.failed > prev.intents.failed) {
      detected = "failure";
    }

    if (detected) {
      setAnomaly({ hasAnomaly: true, anomalyType: detected });
      const timer = setTimeout(() => {
        setAnomaly({ hasAnomaly: false, anomalyType: null });
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [data]);

  return anomaly;
}
