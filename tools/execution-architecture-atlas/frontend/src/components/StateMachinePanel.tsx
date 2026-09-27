import { StateMachineDiagram } from "./StateMachineDiagram";
import type { StateNode, StateTransition } from "./StateMachineDiagram";
import type { LiveSummary } from "../types/liveState";

interface Props {
  liveData: LiveSummary | null;
}

function intentStates(data: LiveSummary | null): { states: StateNode[]; transitions: StateTransition[] } {
  const i = data?.intents;
  const states: StateNode[] = [
    { id: "QUEUED", label: "QUEUED", x: 10, y: 10, count: i?.queued ?? 0, category: "active" },
    { id: "IN_FLIGHT", label: "IN_FLIGHT", x: 120, y: 10, count: i?.in_flight ?? 0, category: "active" },
    { id: "SUBMITTED", label: "SUBMITTED", x: 230, y: 10, count: i?.submitted ?? 0, category: "active" },
    { id: "DONE", label: "DONE", x: 230, y: 70, count: i?.done ?? 0, category: "terminal_ok" },
    { id: "FAILED", label: "FAILED", x: 120, y: 70, count: i?.failed ?? 0, category: "terminal_error" },
    { id: "DLQ", label: "DLQ", x: 10, y: 70, count: i?.dlq ?? 0, category: "terminal_error" },
  ];

  const hasFlow = data?.status === "ok";
  const transitions: StateTransition[] = [
    { from: "QUEUED", to: "IN_FLIGHT", active: hasFlow && (i?.in_flight ?? 0) > 0 },
    { from: "IN_FLIGHT", to: "SUBMITTED", active: hasFlow && (i?.submitted ?? 0) > 0 },
    { from: "SUBMITTED", to: "DONE", active: hasFlow && (i?.done ?? 0) > 0 },
    { from: "IN_FLIGHT", to: "FAILED", active: hasFlow && (i?.failed ?? 0) > 0 },
    { from: "FAILED", to: "DLQ", active: hasFlow && (i?.dlq ?? 0) > 0 },
  ];

  return { states, transitions };
}

function marketStates(data: LiveSummary | null): { states: StateNode[]; transitions: StateTransition[] } {
  const lc = data?.markets.by_lifecycle ?? {};
  const lifecycles = [
    "DISCOVERED", "ELIGIBLE", "TRADING", "CLOSING_SOON",
    "CLOSED", "RESOLVED", "SETTLED", "DELISTED",
  ];

  const states: StateNode[] = lifecycles.map((name, i) => {
    const row = Math.floor(i / 4);
    const col = i % 4;
    const category = name === "TRADING" ? "active" as const
      : ["SETTLED", "RESOLVED"].includes(name) ? "terminal_ok" as const
      : ["DELISTED", "CLOSED"].includes(name) ? "terminal_error" as const
      : "idle" as const;

    return {
      id: name,
      label: name.length > 9 ? name.slice(0, 8) + "." : name,
      x: 10 + col * 100,
      y: 10 + row * 60,
      count: lc[name] ?? 0,
      category,
    };
  });

  const transitions: StateTransition[] = [];
  for (let i = 0; i < lifecycles.length - 1; i++) {
    transitions.push({
      from: lifecycles[i]!,
      to: lifecycles[i + 1]!,
      active: (lc[lifecycles[i + 1]!] ?? 0) > 0,
    });
  }

  return { states, transitions };
}

function authorityStates(data: LiveSummary | null): { states: StateNode[]; transitions: StateTransition[] } {
  const a = data?.authority;
  const killActive = a?.kill_switch_active ?? true;
  const safeMode = a?.safe_mode_enabled ?? false;
  const isLive = data?.status === "ok" && !killActive && !safeMode;

  const states: StateNode[] = [
    {
      id: "KILL_SWITCH", label: "KILL SWITCH", x: 10, y: 10,
      count: killActive ? 1 : 0,
      category: killActive ? "terminal_error" : "idle",
    },
    {
      id: "SAFE_MODE", label: "SAFE MODE", x: 120, y: 10,
      count: safeMode ? 1 : 0,
      category: safeMode ? "terminal_error" : "idle",
    },
    {
      id: "LIVE", label: "LIVE", x: 230, y: 10,
      count: isLive ? 1 : 0,
      category: isLive ? "terminal_ok" : "idle",
    },
  ];

  return { states, transitions: [] };
}

export function StateMachinePanel({ liveData }: Props) {
  const intent = intentStates(liveData);
  const market = marketStates(liveData);
  const authority = authorityStates(liveData);

  return (
    <div className="sm-panel">
      <StateMachineDiagram
        title="Intent Lifecycle"
        states={intent.states}
        transitions={intent.transitions}
        width={330}
        height={125}
      />
      <StateMachineDiagram
        title="Authority Gates"
        states={authority.states}
        transitions={authority.transitions}
        width={330}
        height={70}
      />
      <StateMachineDiagram
        title="Market Lifecycle"
        states={market.states}
        transitions={market.transitions}
        width={410}
        height={140}
      />
    </div>
  );
}
