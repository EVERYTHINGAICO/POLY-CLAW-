use crate::errors::ConfigurationError;
use crate::types::{ExecutionConfig, RiskConfig, RootConfig, SystemConfig};

pub(crate) struct RootConfigLoaderToken(());

pub(crate) fn load_config() -> Result<RootConfig, ConfigurationError> {
    let config = RootConfig::new(
        RootConfigLoaderToken(()),
        ExecutionConfig {
            max_concurrent_orders: 100,
            max_order_size: 1000.0,
            max_retry_attempts: 3,
            max_capital_per_market_usdc: 500.0,
            max_total_capital_at_risk_usdc: 3000.0,
            max_shares_per_outcome: 2000.0,
            min_time_to_expiration_seconds: 60,
        },
        RiskConfig {
            max_exposure_per_market: 10_000.0,
            max_global_exposure: 100_000.0,
        },
        SystemConfig {
            environment: "production".to_string(),
        },
    );

    config.validate()?;
    Ok(config)
}
