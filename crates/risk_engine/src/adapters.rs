pub trait FundsLedgerSnapshotProvider: Send + Sync {
    fn get_total_capital(&self) -> f64;

    fn get_capital_at_risk(&self) -> f64;
}

pub trait MarketRegistrySnapshotProvider: Send + Sync {
    fn get_market_capital(&self, market_id: &str) -> f64;

    fn get_outcome_position(&self, market_id: &str, outcome_id: &str) -> f64;

    fn get_market_expiration(&self, market_id: &str) -> u64;
}

pub struct RiskSnapshotBuilder<'a> {
    pub funds: &'a dyn FundsLedgerSnapshotProvider,
    pub markets: &'a dyn MarketRegistrySnapshotProvider,
}

impl<'a> RiskSnapshotBuilder<'a> {
    pub fn build_snapshot(
        &self,
        market_id: &str,
        outcome_id: &str,
    ) -> crate::types::RiskSnapshot {
        crate::types::RiskSnapshot {
            total_capital: self.funds.get_total_capital(),
            capital_at_risk: self.funds.get_capital_at_risk(),
            capital_per_market: self.markets.get_market_capital(market_id),
            shares_per_outcome: self.markets.get_outcome_position(market_id, outcome_id),
        }
    }

    pub fn get_market_expiration(
        &self,
        market_id: &str,
    ) -> u64 {
        self.markets.get_market_expiration(market_id)
    }
}
