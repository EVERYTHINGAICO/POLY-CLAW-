import { useEffect, useRef, useState } from "react";

interface Snapshot {
  ts: number;
  dataUrl: string;
}

interface SessionPlaybackProps {
  snapshots: Snapshot[];
  onClear: () => void;
  onClose: () => void;
}

export function SessionPlayback({ snapshots, onClear, onClose }: SessionPlaybackProps) {
  const [playing, setPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [fullImage, setFullImage] = useState<string | null>(null);
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (playing && snapshots.length > 0) {
      playRef.current = setInterval(() => {
        setCurrentIndex((prev) => {
          const next = prev + 1;
          if (next >= snapshots.length) {
            setPlaying(false);
            return 0;
          }
          return next;
        });
      }, 1000);
      return () => { if (playRef.current) clearInterval(playRef.current); };
    }
    if (playRef.current) {
      clearInterval(playRef.current);
      playRef.current = null;
    }
  }, [playing, snapshots.length]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString();
  };

  const downloadAll = () => {
    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i]!;
      const link = document.createElement("a");
      link.href = snap.dataUrl;
      link.download = `atlas-session-${i + 1}-${new Date(snap.ts).toISOString().replace(/[:.]/g, "-")}.jpg`;
      link.click();
    }
  };

  return (
    <>
      <div className="session-filmstrip">
        <div className="filmstrip-controls">
          <button type="button" className="filmstrip-btn" onClick={() => { setPlaying(!playing); if (!playing) setCurrentIndex(0); }}>
            {playing ? "Pause" : "Play"}
          </button>
          <span className="filmstrip-info">{snapshots.length} snapshots</span>
          <button type="button" className="filmstrip-btn" onClick={downloadAll}>Export</button>
          <button type="button" className="filmstrip-btn" onClick={onClear}>Clear</button>
          <button type="button" className="filmstrip-btn" onClick={onClose}>Close</button>
        </div>
        <div className="filmstrip-track">
          {snapshots.map((snap, i) => (
            <button
              key={snap.ts}
              type="button"
              className={`filmstrip-thumb${i === currentIndex ? " active" : ""}`}
              onClick={() => setFullImage(snap.dataUrl)}
            >
              <img src={snap.dataUrl} alt={`Snapshot ${i + 1}`} />
              <span className="filmstrip-ts">{formatTime(snap.ts)}</span>
            </button>
          ))}
        </div>
      </div>

      {fullImage && (
        <div className="filmstrip-fullview" onClick={() => setFullImage(null)}>
          <img src={fullImage} alt="Full snapshot" />
        </div>
      )}

      {playing && currentIndex >= 0 && currentIndex < snapshots.length && (
        <div className="filmstrip-playback-overlay">
          <img src={snapshots[currentIndex]!.dataUrl} alt="Playback frame" />
          <div className="filmstrip-playback-ts">
            {formatTime(snapshots[currentIndex]!.ts)} ({currentIndex + 1}/{snapshots.length})
          </div>
        </div>
      )}
    </>
  );
}
