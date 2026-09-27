import { useState } from "react";
import type { AlertRule } from "../hooks/useCustomAlerts";

interface AlertRulesPanelProps {
  rules: AlertRule[];
  onRulesChange: (rules: AlertRule[]) => void;
  firedRules: AlertRule[];
}

const METRICS = [
  { value: "queued", label: "Queued Intents" },
  { value: "in_flight", label: "In-Flight Intents" },
  { value: "failed", label: "Failed Intents" },
  { value: "dlq_count", label: "DLQ Count" },
  { value: "available_capital", label: "Available Capital" },
  { value: "total_positions", label: "Total Positions" },
  { value: "unrealized_pnl", label: "Unrealized PnL" },
];

const OPERATORS = [">", "<", ">=", "<=", "=="] as const;
const SEVERITIES = ["info", "warning", "critical"] as const;

export function AlertRulesPanel({ rules, onRulesChange, firedRules }: AlertRulesPanelProps) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [metric, setMetric] = useState("queued");
  const [operator, setOperator] = useState<">" | "<" | ">=" | "<=" | "==">(">");
  const [threshold, setThreshold] = useState(0);
  const [severity, setSeverity] = useState<"info" | "warning" | "critical">("warning");

  const firedIds = new Set(firedRules.map((r) => r.id));

  const addRule = () => {
    if (!name.trim()) return;
    const rule: AlertRule = {
      id: `rule-${Date.now()}`,
      name: name.trim(),
      metric,
      operator,
      threshold,
      severity,
      enabled: true,
    };
    onRulesChange([...rules, rule]);
    setAdding(false);
    setName("");
    setThreshold(0);
  };

  const removeRule = (id: string) => {
    onRulesChange(rules.filter((r) => r.id !== id));
  };

  const toggleRule = (id: string) => {
    onRulesChange(rules.map((r) => r.id === id ? { ...r, enabled: !r.enabled } : r));
  };

  return (
    <div className="alert-rules-panel">
      <div className="alert-rules-header">
        <span>Custom Alert Rules</span>
        <button type="button" className="alert-add-btn" onClick={() => setAdding(!adding)}>
          {adding ? "Cancel" : "+ Add Rule"}
        </button>
      </div>

      {adding && (
        <div className="alert-rule-form">
          <input
            className="alert-input"
            placeholder="Rule name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="alert-form-row">
            <select className="alert-select" value={metric} onChange={(e) => setMetric(e.target.value)}>
              {METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <select className="alert-select" value={operator} onChange={(e) => setOperator(e.target.value as typeof operator)}>
              {OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
            </select>
            <input
              className="alert-input threshold"
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </div>
          <div className="alert-form-row">
            <select className="alert-select" value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="button" className="alert-save-btn" onClick={addRule}>Save</button>
          </div>
        </div>
      )}

      <div className="alert-rules-list">
        {rules.length === 0 && !adding && (
          <div className="alert-empty">No alert rules configured</div>
        )}
        {rules.map((rule) => (
          <div key={rule.id} className={`alert-rule-item${firedIds.has(rule.id) ? " fired" : ""}${!rule.enabled ? " disabled" : ""}`}>
            <div className="alert-rule-top">
              <button type="button" className="alert-toggle" onClick={() => toggleRule(rule.id)}>
                {rule.enabled ? "ON" : "OFF"}
              </button>
              <span className="alert-rule-name">{rule.name}</span>
              <span className={`alert-severity-badge ${rule.severity}`}>{rule.severity}</span>
              <button type="button" className="alert-remove-btn" onClick={() => removeRule(rule.id)}>×</button>
            </div>
            <div className="alert-rule-condition">
              {METRICS.find((m) => m.value === rule.metric)?.label ?? rule.metric} {rule.operator} {rule.threshold}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
