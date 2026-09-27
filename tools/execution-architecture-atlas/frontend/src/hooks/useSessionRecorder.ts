import { useCallback, useEffect, useRef, useState } from "react";

interface Snapshot {
  ts: number;
  dataUrl: string;
}

const MAX_SNAPSHOTS = 120;

export function useSessionRecorder(fgRef: React.RefObject<any>) {
  const [recording, setRecording] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const captureSnapshot = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;

    try {
      const renderer = typeof fg.renderer === "function" ? fg.renderer() : fg.renderer;
      const canvas = renderer?.domElement;
      if (!(canvas instanceof HTMLCanvasElement)) return;

      const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
      setSnapshots((prev) => {
        const next = [...prev, { ts: Date.now(), dataUrl }];
        if (next.length > MAX_SNAPSHOTS) next.shift();
        return next;
      });
    } catch {
      // Canvas capture may fail
    }
  }, [fgRef]);

  const startRecording = useCallback(() => {
    setRecording(true);
    captureSnapshot(); // Capture immediately
  }, [captureSnapshot]);

  const stopRecording = useCallback(() => {
    setRecording(false);
  }, []);

  const clearSnapshots = useCallback(() => {
    setSnapshots([]);
  }, []);

  useEffect(() => {
    if (recording) {
      intervalRef.current = setInterval(captureSnapshot, 30000);
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [recording, captureSnapshot]);

  return { recording, snapshots, startRecording, stopRecording, clearSnapshots };
}
