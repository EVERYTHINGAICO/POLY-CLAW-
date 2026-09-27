import { useEffect, useState } from "react";
import type { PreflightCheck, PreflightResponse } from "../types/liveState";

interface Props {
  onClose: () => void;
}

export function PreflightPanel({ onClose }: Props) {
  const [checks, setChecks] = useState<PreflightCheck[]>([]);
  const [ready, setReady] = useState(false);
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const poll = async () => {
      try {
        const response = await fetch("/api/live/preflight");
        if (!response.ok) return;
        const payload = (await response.json()) as PreflightResponse;
        if (mounted) {
          setChecks(payload.checks);
          setReady(payload.ready);
        }
      } catch {
        // silently ignore
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), 3000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);

  const goCount = checks.filter((c) => c.status === "GO").length;
  const warnCount = checks.filter((c) => c.status === "WARN").length;
  const noGoCount = checks.filter((c) => c.status === "NO_GO").length;

  return (
    <div className="preflight-overlay" onClick={onClose}>
      <div className="preflight-modal" onClick={(e) => e.stopPropagation()}>
        <div className="preflight-header">
          <h2>PRE-FLIGHT READINESS CHECK</h2>
          <div className={`preflight-verdict ${ready ? "ready" : "not-ready"}`}>
            {ready ? "READY" : "NOT READY"}
          </div>
        </div>

        <div className="preflight-checks">
          {checks.map((check) => (
            <div key={check.name} className="preflight-check-row">
              <button
                type="button"
                className="preflight-check-btn"
                onClick={() =>
                  setExpandedCheck(expandedCheck === check.name ? null : check.name)
                }
              >
                <span className="preflight-check-name">{check.name}</span>
                <span className="preflight-dots" />
                <span className={`preflight-status preflight-${check.status.toLowerCase()}`}>
                  {check.status === "GO" ? "GO" : check.status === "WARN" ? "WARN" : "NO GO"}
                </span>
              </button>
              {expandedCheck === check.name && (
                <div className="preflight-detail">{check.detail}</div>
              )}
            </div>
          ))}
        </div>

        <div className="preflight-summary">
          <span className="preflight-go">{goCount} GO</span>
          <span className="preflight-warn-count">{warnCount} WARN</span>
          <span className="preflight-nogo">{noGoCount} NO-GO</span>
        </div>

        <button type="button" className="preflight-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

export function ReadinessIndicator({
  onClick,
}: {
  onClick: () => void;
}) {
  const [checks, setChecks] = useState<PreflightCheck[]>([]);

  useEffect(() => {
    let mounted = true;

    const poll = async () => {
      try {
        const response = await fetch("/api/live/preflight");
        if (!response.ok) return;
        const payload = (await response.json()) as PreflightResponse;
        if (mounted) setChecks(payload.checks);
      } catch {
        // ignore
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);

  const hasNoGo = checks.some((c) => c.status === "NO_GO");
  const hasWarn = checks.some((c) => c.status === "WARN");

  return (
    <button type="button" className="readiness-indicator" onClick={onClick} title="Pre-flight Check">
      <span className={`ri-dot ${hasNoGo ? "red" : hasWarn ? "amber" : "green"}`} />
      <span className={`ri-dot ${hasNoGo ? "red" : hasWarn ? "amber" : "green"}`} />
      <span className={`ri-dot ${hasNoGo ? "red" : "green"}`} />
    </button>
  );
}
