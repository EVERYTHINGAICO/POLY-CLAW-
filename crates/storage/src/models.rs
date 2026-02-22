use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Market {
    pub market_id: String,
    pub question: String,
    pub category: Option<String>,
    pub tags_json: Option<String>,
    pub end_time_ts_ms: i64,
    pub status: String,
    pub active: bool,
    pub closed: bool,
    pub resolved: bool,
    pub volume: Option<f64>,
    pub liquidity: Option<f64>,
    pub yes_token_id: Option<String>,
    pub no_token_id: Option<String>,
    pub tick_size: Option<f64>,
    pub min_order_size: Option<f64>,
    pub fee_model: Option<String>,
    pub lifecycle_state: String,
    pub last_refreshed_ts_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketToken {
    pub market_id: String,
    pub yes_token_id: String,
    pub no_token_id: String,
    pub tick_size: f64,
    pub min_order_size: f64,
    pub price_min: f64,
    pub price_max: f64,
    pub fee_bps: i64,
    pub source: String,
    pub last_refreshed_ts_ms: i64,
    pub valid: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenOrder {
    pub order_id: String,
    pub client_order_id: String,
    pub exchange_order_id: Option<String>,
    pub strategy_id: Option<String>,
    pub market_id: String,
    pub token_id: Option<String>,
    pub side: String,
    pub price: f64,
    pub size: f64,
    pub filled_size: f64,
    pub status: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fill {
    pub fill_id: String,
    pub exchange_fill_id: String,
    pub order_id: String,
    pub exchange_order_id: Option<String>,
    pub market_id: String,
    pub token_id: String,
    pub side: String,
    pub price: f64,
    pub size: f64,
    pub fee_usdc: Option<f64>,
    pub liquidity: Option<String>,
    pub exchange_ts_ms: i64,
    pub ingest_ts_ms: i64,
    pub raw_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionIntent {
    pub intent_id: String,
    pub ts_ms: i64,
    pub market_id: String,
    pub intent_type: String,
    pub payload_json: String,
    pub state: String,
    pub idempotency_key: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FundsLedgerEntry {
    pub ledger_entry_id: String,
    pub event_type: String,
    pub order_id: Option<String>,
    pub market_id: Option<String>,
    pub delta_available: f64,
    pub delta_locked: f64,
    pub delta_reserved: f64,
    pub delta_settlement_pending: f64,
    pub total_balance: f64,
    pub available_balance: f64,
    pub locked_balance: f64,
    pub reserved_balance: f64,
    pub settlement_pending_balance: f64,
    pub reason: String,
    pub ts_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub market_id: String,
    pub yes_qty: f64,
    pub no_qty: f64,
    pub avg_price_yes: f64,
    pub avg_price_no: f64,
    pub realized_pnl: f64,
    pub unrealized_pnl: f64,
    pub status: String,
    pub updated_at_ms: i64,
}
