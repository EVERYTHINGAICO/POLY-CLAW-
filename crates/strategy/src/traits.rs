use crate::errors::StrategyError;
use crate::types::{StrategyContext, StrategyDecision};

pub trait Strategy: Send + Sync {
    fn evaluate(&self, context: &StrategyContext) -> Result<StrategyDecision, StrategyError>;
}
