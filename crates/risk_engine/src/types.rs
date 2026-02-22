#[derive(Clone, Debug)]
pub enum RiskDecision {
    Allowed,
    Rejected(RiskRejectionReason),
}

#[derive(Clone, Debug)]
pub enum RiskRejectionReason {
    InsufficientCapital,
    MarketExposureExceeded,
    GlobalExposureExceeded,
    OutcomeLimitExceeded,
    ExpirationWindowViolation,
    RiskViolationSafeMode,
}

#[derive(Clone, Debug)]
pub struct RiskRequest {
    pub market_id: String,
    pub outcome_id: String,
    pub requested_shares: f64,
    pub price: f64,
    pub expiration_timestamp: u64,
    pub current_timestamp: u64,
}

#[derive(Clone, Debug)]
pub struct RiskSnapshot {
    pub total_capital: f64,
    pub capital_at_risk: f64,
    pub capital_per_market: f64,
    pub shares_per_outcome: f64,
}
