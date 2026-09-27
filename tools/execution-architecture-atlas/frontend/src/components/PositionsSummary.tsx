import type { PositionsSummary as PositionsData } from "../types/liveState";

interface Props {
  positions: PositionsData;
}

function formatPnl(n: number): string {
  const prefix = n >= 0 ? "+" : "";
  if (Math.abs(n) >= 1000) return `${prefix}$${(n / 1000).toFixed(2)}k`;
  return `${prefix}$${n.toFixed(2)}`;
}

function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return id.slice(0, 6) + "..." + id.slice(-4);
}

export function PositionsSummaryPanel({ positions }: Props) {
  const sorted = [...positions.markets].sort(
    (a, b) => Math.abs(b.unrealized_pnl) - Math.abs(a.unrealized_pnl),
  );

  const totalPnl = positions.total_realized_pnl + positions.total_unrealized_pnl;

  return (
    <div className="positions-panel">
      <div className="positions-header">
        <span>Open: {positions.total_open}</span>
        <span className={totalPnl >= 0 ? "pnl-positive" : "pnl-negative"}>
          Total: {formatPnl(totalPnl)}
        </span>
      </div>

      {sorted.length === 0 && (
        <p style={{ color: "var(--text-soft)", fontSize: "0.84rem" }}>No open positions</p>
      )}

      <div className="positions-list">
        {sorted.map((p) => (
          <div key={p.market_id} className="position-row">
            <span className="position-market" title={p.market_id}>
              {truncateId(p.market_id)}
            </span>
            <span className="position-qty">
              Y:{p.yes_qty.toFixed(1)} N:{p.no_qty.toFixed(1)}
            </span>
            <span className={p.unrealized_pnl >= 0 ? "pnl-positive" : "pnl-negative"}>
              {formatPnl(p.unrealized_pnl)}
            </span>
          </div>
        ))}
      </div>

      {positions.total_open > 0 && (
        <div className="positions-footer">
          <span>Realized: {formatPnl(positions.total_realized_pnl)}</span>
          <span>Unrealized: {formatPnl(positions.total_unrealized_pnl)}</span>
        </div>
      )}
    </div>
  );
}
