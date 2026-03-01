#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FillSide {
    Buy,
    Sell,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FillEvent {
    pub fill_id: String,
    pub order_id: String,
    pub market_id: String,
    pub token_id: String,
    pub side: FillSide,
    pub price: f64,
    pub size: f64,
    pub fee_usdc: Option<f64>,
    pub exchange_ts_ms: u64,
    pub ingest_ts_ms: u64,
    pub raw_json: Option<String>,
}
