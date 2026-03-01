#[derive(Clone, Debug, PartialEq)]
pub struct StrategyContext {
    pub market_id: String,
    pub outcome_id: String,
    pub reference_price: f64,
    pub timestamp_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StrategyOrderSide {
    Buy,
    Sell,
}

#[derive(Clone, Debug, PartialEq)]
pub struct StrategyOrderRequest {
    pub market_id: String,
    pub outcome_id: String,
    pub side: StrategyOrderSide,
    pub quantity: f64,
    pub price: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub enum StrategyDecision {
    NoAction,
    SubmitOrder(StrategyOrderRequest),
}
