import { useCallback, useRef, useState } from "react";

interface TimelineScrubberProps {
  mode: "live" | "replay";
  replayTs: number;
  earliestMs: number;
  latestMs: number;
  onScrub: (ts: number) => void;
  onGoLive: () => void;
  loading: boolean;
}

export function TimelineScrubber({ mode, replayTs, earliestMs, latestMs, onScrub, onGoLive, loading }: TimelineScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const range = Math.max(latestMs - earliestMs, 1);
  const position = mode === "live" ? 1 : Math.max(0, Math.min(1, (replayTs - earliestMs) / range));

  const scrubFromEvent = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ts = Math.round(earliestMs + ratio * range);
    onScrub(ts);
  }, [earliestMs, range, onScrub]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setDragging(true);
    scrubFromEvent(e.clientX);

    const handleMove = (ev: MouseEvent) => scrubFromEvent(ev.clientX);
    const handleUp = () => {
      setDragging(false);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  const formatTs = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString();
  };

  return (
    <div className={`timeline-scrubber${mode === "replay" ? " replay-active" : ""}`}>
      <div className="scrubber-controls">
        <button
          type="button"
          className={`scrubber-live-btn${mode === "live" ? " active" : ""}`}
          onClick={onGoLive}
        >
          LIVE
        </button>
        {mode === "replay" && (
          <span className="scrubber-timestamp">
            {loading ? "Loading..." : formatTs(replayTs)}
          </span>
        )}
      </div>
      <div
        ref={trackRef}
        className={`scrubber-track${dragging ? " dragging" : ""}`}
        onMouseDown={handleMouseDown}
      >
        <div className="scrubber-fill" style={{ width: `${position * 100}%` }} />
        <div
          className="scrubber-handle"
          style={{ left: `${position * 100}%` }}
        />
      </div>
      <div className="scrubber-labels">
        <span>{formatTs(earliestMs)}</span>
        <span>{formatTs(latestMs)}</span>
      </div>
    </div>
  );
}
