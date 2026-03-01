use crate::errors::RiskEngineError;
use crate::traits::RiskValidator;
use crate::types::{RiskDecision, RiskRequest, RiskSnapshot};

pub struct RiskEngine {
    config_provider: std::sync::Arc<dyn config::provider::ConfigurationProvider>,
}

impl RiskEngine {
    pub fn new(
        config_provider: std::sync::Arc<dyn config::provider::ConfigurationProvider>,
    ) -> Self {
        Self { config_provider }
    }
}

impl RiskValidator for RiskEngine {
    fn validate(
        &self,
        request: &RiskRequest,
        snapshot: &RiskSnapshot,
    ) -> Result<RiskDecision, RiskEngineError> {
        let config = self.config_provider.get_config();
        let execution = config.execution();

        if request.expiration_timestamp < request.current_timestamp {
            return Err(RiskEngineError::InvariantViolation);
        }

        let time_remaining = request
            .expiration_timestamp
            .saturating_sub(request.current_timestamp);
        if time_remaining <= execution.min_time_to_expiration_seconds {
            return Ok(RiskDecision::Rejected(
                crate::types::RiskRejectionReason::ExpirationWindowViolation,
            ));
        }

        let required_capital = request.price * request.requested_shares;

        let available_balance = snapshot.total_capital - snapshot.capital_at_risk;
        let market_locked_capital = snapshot.capital_per_market;
        let total_locked_balance = snapshot.capital_at_risk;
        let outcome_position = snapshot.shares_per_outcome;

        if required_capital > available_balance {
            return Ok(RiskDecision::Rejected(
                crate::types::RiskRejectionReason::InsufficientCapital,
            ));
        }

        if market_locked_capital + required_capital > execution.max_capital_per_market_usdc {
            return Ok(RiskDecision::Rejected(
                crate::types::RiskRejectionReason::MarketExposureExceeded,
            ));
        }

        if total_locked_balance + required_capital > execution.max_total_capital_at_risk_usdc {
            return Ok(RiskDecision::Rejected(
                crate::types::RiskRejectionReason::GlobalExposureExceeded,
            ));
        }

        if outcome_position + request.requested_shares > execution.max_shares_per_outcome {
            return Ok(RiskDecision::Rejected(
                crate::types::RiskRejectionReason::OutcomeLimitExceeded,
            ));
        }

        Ok(RiskDecision::Allowed)
    }
}
