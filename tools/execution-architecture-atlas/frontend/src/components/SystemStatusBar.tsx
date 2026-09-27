import type { LiveSummary } from "../types/liveState";

interface Props {
  data: LiveSummary | null;
  isLive: boolean;
  lastUpdated: number;
  nodeCount: number;
  edgeCount: number;
  layerCount: number;
  totalLayers: number;
  focusMode: boolean;
  activePreset: string;
  traceStatus: string;
  exportStatus: string;
}

function relativeTime(ms: number): string {
  if (ms === 0) return "never";
  const elapsed = Math.floor((Date.now() - ms) / 1000);
  if (elapsed < 2) return "just now";
  if (elapsed < 60) return `${elapsed}s ago`;
  return `${Math.floor(elapsed / 60)}m ago`;
}

function formatUsd(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

export function SystemStatusBar({
  data,
  isLive,
  lastUpdated,
  nodeCount,
  edgeCount,
  layerCount,
  totalLayers,
  focusMode,
  activePreset,
  traceStatus,
  exportStatus,
}: Props) {
  const hasAuthIssue =
    data?.authority.kill_switch_active || data?.authority.safe_mode_enabled;

  return (
    <div className="system-status-bar">
      <div className="ssb-left">
        <span className={`ssb-dot ${isLive ? "live" : data ? "stale" : "offline"}`} />

        {data?.status === "ok" && (
          <>
            {data.authority.kill_switch_active ? (
              <span className="ssb-badge ssb-badge-danger pulse">KILL SWITCH</span>
            ) : data.authority.safe_mode_enabled ? (
              <span className="ssb-badge ssb-badge-warn">SAFE MODE</span>
            ) : (
              <span className="ssb-badge ssb-badge-ok">LIVE</span>
            )}

            {data.intents.queued + data.intents.in_flight + data.intents.submitted > 0 && (
              <span className="ssb-metric">
                {data.intents.queued}Q {data.intents.in_flight}F {data.intents.submitted}S
              </span>
            )}

            {data.capital.total_balance > 0 && (
              <span className="ssb-metric">
                {formatUsd(data.capital.available_balance)} avail
              </span>
            )}

            {data.dlq.count > 0 && (
              <span className="ssb-badge ssb-badge-danger">DLQ: {data.dlq.count}</span>
            )}

            {data.positions.total_unrealized_pnl !== 0 && (
              <span
                className={`ssb-metric ${data.positions.total_unrealized_pnl >= 0 ? "positive" : "negative"}`}
              >
                PnL: {data.positions.total_unrealized_pnl >= 0 ? "+" : ""}
                {formatUsd(data.positions.total_unrealized_pnl)}
              </span>
            )}
          </>
        )}

        {data?.status === "unavailable" && (
          <span className="ssb-metric dim">DB unavailable</span>
        )}
      </div>

      <div className="ssb-center">
        <span className="ssb-metric dim">
          {nodeCount} nodes · {edgeCount} edges · {layerCount} layers
          {focusMode ? " · Focus" : ""} · {activePreset}
        </span>
        {traceStatus !== "No runtime traces detected" && (
          <span className="ssb-metric dim">{traceStatus}</span>
        )}
      </div>

      <div className="ssb-right">
        {exportStatus && <span className="ssb-metric dim">{exportStatus}</span>}
        {lastUpdated > 0 && (
          <span className="ssb-metric dim">{relativeTime(lastUpdated)}</span>
        )}
      </div>
    </div>
  );
}
