use serde::{Deserialize, Serialize};

#[non_exhaustive]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RiskConfig {
    pub max_exposure_per_market: f64,
    pub max_global_exposure: f64,
}
