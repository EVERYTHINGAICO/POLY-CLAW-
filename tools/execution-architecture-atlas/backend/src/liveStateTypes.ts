export interface AuthorityState {
  kill_switch_active: boolean;
  safe_mode_enabled: boolean;
  safe_mode_reason: string | null;
}

export interface IntentFailure {
  intent_id: string;
  market_id: string;
  intent_type: string;
  last_error: string | null;
  ts_ms: number;
}

export interface IntentsSummary {
  queued: number;
  in_flight: number;
  submitted: number;
  done: number;
  failed: number;
  dlq: number;
  recent_failures: IntentFailure[];
}

export interface RecentFill {
  fill_id: string;
  market_id: string;
  side: string;
  price: number;
  size: number;
  fee_usdc: number | null;
  exchange_ts_ms: number;
}

export interface OrdersSummary {
  total_open: number;
  by_status: Record<string, number>;
  recent_fills: RecentFill[];
}

export interface CapitalSummary {
  total_balance: number;
  available_balance: number;
  locked_balance: number;
  reserved_balance: number;
  settlement_pending_balance: number;
}

export interface PositionEntry {
  market_id: string;
  yes_qty: number;
  no_qty: number;
  realized_pnl: number;
  unrealized_pnl: number;
  status: string;
}

export interface PositionsSummary {
  total_open: number;
  total_realized_pnl: number;
  total_unrealized_pnl: number;
  markets: PositionEntry[];
}

export interface DlqItem {
  dlq_id: string;
  intent_id: string;
  market_id: string;
  reason: string;
  attempts: number;
  first_seen_ts_ms: number;
  last_attempt_ts_ms: number;
}

export interface DlqSummary {
  count: number;
  items: DlqItem[];
}

export interface MarketsSummary {
  by_lifecycle: Record<string, number>;
  total: number;
}

export interface LiveSummary {
  status: "ok" | "unavailable";
  timestamp_ms: number;
  reason?: string;
  authority: AuthorityState;
  intents: IntentsSummary;
  orders: OrdersSummary;
  capital: CapitalSummary;
  positions: PositionsSummary;
  markets: MarketsSummary;
  dlq: DlqSummary;
}

export interface IntentRecord {
  intent_id: string;
  ts_ms: number;
  market_id: string;
  intent_type: string;
  state: string;
  last_error: string | null;
}

export interface OrderRecord {
  order_id: string;
  market_id: string;
  side: string;
  price: number;
  size: number;
  filled_size: number;
  status: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface FundsEntry {
  event_type: string;
  delta_available: number;
  delta_locked: number;
  total_balance: number;
  available_balance: number;
  locked_balance: number;
  ts_ms: number;
  reason: string;
}

export interface SystemEvent {
  id: string;
  ts_ms: number;
  event_type: "intent" | "fill" | "dlq";
  detail: string;
  severity: "info" | "success" | "warning" | "error";
}

export interface PreflightCheck {
  name: string;
  status: "GO" | "NO_GO" | "WARN";
  detail: string;
}

export interface PreflightResponse {
  status: "ok";
  ready: boolean;
  checks: PreflightCheck[];
}
