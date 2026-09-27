export interface StateNode {
  id: string;
  label: string;
  x: number;
  y: number;
  count: number;
  category: "active" | "terminal_ok" | "terminal_error" | "idle";
}

export interface StateTransition {
  from: string;
  to: string;
  active: boolean;
}

interface Props {
  states: StateNode[];
  transitions: StateTransition[];
  width: number;
  height: number;
  title: string;
}

const CATEGORY_COLORS = {
  active: { fill: "rgba(59, 130, 246, 0.25)", stroke: "#3b82f6", text: "#93c5fd" },
  terminal_ok: { fill: "rgba(34, 197, 94, 0.25)", stroke: "#22c55e", text: "#86efac" },
  terminal_error: { fill: "rgba(239, 68, 68, 0.25)", stroke: "#ef4444", text: "#fca5a5" },
  idle: { fill: "rgba(100, 116, 139, 0.2)", stroke: "#64748b", text: "#94a3b8" },
};

const NODE_W = 90;
const NODE_H = 44;
const NODE_RX = 10;

export function StateMachineDiagram({ states, transitions, width, height, title }: Props) {
  const stateMap = new Map(states.map((s) => [s.id, s]));

  return (
    <div className="sm-diagram">
      <div className="sm-diagram-title">{title}</div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5"
            markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
          </marker>
          <marker id="arrow-active" viewBox="0 0 10 10" refX="10" refY="5"
            markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />
          </marker>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {transitions.map((t, i) => {
          const from = stateMap.get(t.from);
          const to = stateMap.get(t.to);
          if (!from || !to) return null;

          const x1 = from.x + NODE_W / 2;
          const y1 = from.y + NODE_H / 2;
          const x2 = to.x + NODE_W / 2;
          const y2 = to.y + NODE_H / 2;

          const dx = x2 - x1;
          const dy = y2 - y1;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const ux = dx / dist;
          const uy = dy / dist;

          const sx = x1 + ux * (NODE_W / 2 + 2);
          const sy = y1 + uy * (NODE_H / 2 + 2);
          const ex = x2 - ux * (NODE_W / 2 + 8);
          const ey = y2 - uy * (NODE_H / 2 + 8);

          return (
            <line
              key={`t-${i}`}
              x1={sx} y1={sy} x2={ex} y2={ey}
              stroke={t.active ? "#38bdf8" : "#475569"}
              strokeWidth={t.active ? 2 : 1.2}
              markerEnd={t.active ? "url(#arrow-active)" : "url(#arrow)"}
              filter={t.active ? "url(#glow)" : undefined}
              opacity={t.active ? 1 : 0.6}
            />
          );
        })}

        {states.map((s) => {
          const colors = CATEGORY_COLORS[s.category];
          const hasItems = s.count > 0;

          return (
            <g key={s.id}>
              <rect
                x={s.x} y={s.y}
                width={NODE_W} height={NODE_H}
                rx={NODE_RX}
                fill={colors.fill}
                stroke={hasItems ? colors.stroke : "#334155"}
                strokeWidth={hasItems ? 1.8 : 1}
              />
              <text
                x={s.x + NODE_W / 2} y={s.y + 18}
                textAnchor="middle"
                fill={colors.text}
                fontSize="10"
                fontWeight="600"
                fontFamily="IBM Plex Sans, Segoe UI, sans-serif"
              >
                {s.label}
              </text>
              <text
                x={s.x + NODE_W / 2} y={s.y + 34}
                textAnchor="middle"
                fill={hasItems ? "#e2e8f0" : "#475569"}
                fontSize="13"
                fontWeight="700"
                fontFamily="IBM Plex Sans, Segoe UI, sans-serif"
              >
                {s.count}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
