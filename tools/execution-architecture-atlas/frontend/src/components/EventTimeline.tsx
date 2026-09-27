import type { SystemEvent } from "../types/liveState";

interface Props {
  events: SystemEvent[];
  onDlqClick?: (intentId: string) => void;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const TYPE_BADGES: Record<string, { label: string; color: string }> = {
  intent: { label: "INT", color: "#7dd3fc" },
  fill: { label: "FILL", color: "#86efac" },
  dlq: { label: "DLQ", color: "#fca5a5" },
};

export function EventTimeline({ events, onDlqClick }: Props) {
  if (events.length === 0) {
    return (
      <div className="event-timeline" style={{ color: "var(--text-soft)", fontSize: "0.78rem", padding: "8px 0" }}>
        No events recorded yet
      </div>
    );
  }

  return (
    <div className="event-timeline">
      {events.map((event, i) => {
        const badge = TYPE_BADGES[event.event_type] ?? { label: "???", color: "#94a3b8" };
        const isClickable = event.event_type === "dlq" && onDlqClick;

        return (
          <button
            key={`${event.id}-${event.ts_ms}-${i}`}
            type="button"
            className={`event-item severity-${event.severity}`}
            onClick={isClickable ? () => onDlqClick(event.id) : undefined}
            style={{ cursor: isClickable ? "pointer" : "default" }}
          >
            <span className="event-ts">{formatTime(event.ts_ms)}</span>
            <span className="event-type-badge" style={{ background: `${badge.color}22`, color: badge.color }}>
              {badge.label}
            </span>
            <span className="event-detail">{event.detail}</span>
          </button>
        );
      })}
    </div>
  );
}
