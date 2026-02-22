use serde::{Deserialize, Serialize};

#[non_exhaustive]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ExecutionConfig {
    pub max_concurrent_orders: usize,
    pub max_order_size: f64,
    pub max_retry_attempts: u32,
    pub max_capital_per_market_usdc: f64,
    pub max_total_capital_at_risk_usdc: f64,
    pub max_shares_per_outcome: f64,
    pub min_time_to_expiration_seconds: u64,
}
