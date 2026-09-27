import { useEffect, useRef } from "react";
import type { LiveSummary } from "../types/liveState";

export interface AlertRule {
  id: string;
  name: string;
  metric: string;
  operator: ">" | "<" | ">=" | "<=" | "==";
  threshold: number;
  severity: "info" | "warning" | "critical";
  enabled: boolean;
}

function getMetricValue(metric: string, data: LiveSummary): number | null {
  switch (metric) {
    case "queued": return data.intents.queued;
    case "in_flight": return data.intents.in_flight;
    case "failed": return data.intents.failed;
    case "dlq_count": return data.dlq.count;
    case "available_capital": return data.capital.available_balance;
    case "total_positions": return data.positions.total_open;
    case "unrealized_pnl": return data.positions.total_unrealized_pnl;
    default: return null;
  }
}

function evaluate(value: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case ">": return value > threshold;
    case "<": return value < threshold;
    case ">=": return value >= threshold;
    case "<=": return value <= threshold;
    case "==": return value === threshold;
    default: return false;
  }
}

export function useCustomAlerts(
  rules: AlertRule[],
  liveData: LiveSummary | null,
): { firedRules: AlertRule[] } {
  const prevFiredRef = useRef<Set<string>>(new Set());
  const newlyFiredRef = useRef<AlertRule[]>([]);

  useEffect(() => {
    if (!liveData || liveData.status !== "ok") {
      newlyFiredRef.current = [];
      return;
    }

    const currentlyFired = new Set<string>();
    const newlyFired: AlertRule[] = [];

    for (const rule of rules) {
      if (!rule.enabled) continue;
      const value = getMetricValue(rule.metric, liveData);
      if (value === null) continue;
      if (evaluate(value, rule.operator, rule.threshold)) {
        currentlyFired.add(rule.id);
        if (!prevFiredRef.current.has(rule.id)) {
          newlyFired.push(rule);
        }
      }
    }

    prevFiredRef.current = currentlyFired;
    newlyFiredRef.current = newlyFired;
  }, [rules, liveData]);

  return {
    firedRules: newlyFiredRef.current,
  };
}
