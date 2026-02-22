use crate::errors::RiskEngineError;
use crate::types::{RiskDecision, RiskRequest, RiskSnapshot};

pub trait RiskValidator: Send + Sync {
    fn validate(
        &self,
        request: &RiskRequest,
        snapshot: &RiskSnapshot,
    ) -> Result<RiskDecision, RiskEngineError>;
}
