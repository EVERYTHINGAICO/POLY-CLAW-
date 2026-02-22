use crate::errors::ConfigurationError;
use serde::{Deserialize, Serialize};

pub use crate::environment_config::SystemConfig;
pub use crate::execution_config::ExecutionConfig;
pub use crate::risk_config::RiskConfig;

#[non_exhaustive]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RootConfig {
    execution: ExecutionConfig,
    risk: RiskConfig,
    system: SystemConfig,
}

impl RootConfig {
    pub(crate) fn new(
        _loader_token: crate::loader::RootConfigLoaderToken,
        execution: ExecutionConfig,
        risk: RiskConfig,
        system: SystemConfig,
    ) -> Self {
        Self {
            execution,
            risk,
            system,
        }
    }

    pub fn execution(&self) -> &ExecutionConfig {
        &self.execution
    }

    pub fn risk(&self) -> &RiskConfig {
        &self.risk
    }

    pub fn system(&self) -> &SystemConfig {
        &self.system
    }

    pub fn validate(&self) -> Result<(), ConfigurationError> {
        if self.execution.max_concurrent_orders == 0
            || self.execution.max_retry_attempts == 0
            || self.execution.max_order_size <= 0.0
            || self.execution.max_capital_per_market_usdc <= 0.0
            || self.execution.max_total_capital_at_risk_usdc <= 0.0
            || self.execution.max_shares_per_outcome <= 0.0
            || self.execution.min_time_to_expiration_seconds == 0
            || self.risk.max_exposure_per_market <= 0.0
            || self.risk.max_global_exposure <= 0.0
        {
            return Err(ConfigurationError::InvalidConfiguration);
        }

        if self.system.environment.trim().is_empty() {
            return Err(ConfigurationError::MissingField);
        }

        Ok(())
    }
}
