import type { CapitalSummary } from "../types/liveState";

interface Props {
  capital: CapitalSummary;
}

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  if (endAngle - startAngle >= 360) {
    const half = startAngle + 180;
    return arcPath(cx, cy, r, startAngle, half) + " " + arcPath(cx, cy, r, half, endAngle);
  }
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function formatUsd(n: number): string {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export function CapitalGauge({ capital }: Props) {
  const total = capital.total_balance || 1;
  const cx = 70;
  const cy = 70;
  const r = 52;
  const strokeWidth = 10;

  const segments = [
    { value: capital.available_balance, color: "#22c55e", label: "Available" },
    { value: capital.locked_balance, color: "#f59e0b", label: "Locked" },
    { value: capital.reserved_balance, color: "#3b82f6", label: "Reserved" },
    { value: capital.settlement_pending_balance, color: "#64748b", label: "Settlement" },
  ];

  let currentAngle = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const sweep = (s.value / total) * 360;
      const start = currentAngle;
      currentAngle += sweep;
      return { ...s, startAngle: start, endAngle: start + sweep };
    });

  return (
    <div className="capital-gauge">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth={strokeWidth} />
        {arcs.map((arc, i) => (
          <path
            key={i}
            d={arcPath(cx, cy, r, arc.startAngle, arc.endAngle)}
            fill="none"
            stroke={arc.color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="#e2e8f0" fontSize="14" fontWeight="700"
          fontFamily="IBM Plex Sans, Segoe UI, sans-serif">
          {formatUsd(capital.total_balance)}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="#94a3b8" fontSize="9"
          fontFamily="IBM Plex Sans, Segoe UI, sans-serif">
          TOTAL CAPITAL
        </text>
      </svg>
      <div className="gauge-legend">
        {segments.filter((s) => s.value > 0).map((s) => (
          <div key={s.label} className="gauge-legend-item">
            <span className="legend-swatch" style={{ background: s.color }} />
            <span>{s.label}: {formatUsd(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
