use std::sync::Arc;

use crate::errors::StrategyError;
use crate::traits::Strategy;
use crate::types::{StrategyContext, StrategyDecision};

#[derive(Clone, Default)]
pub struct StrategyEngine {
    strategies: Vec<Arc<dyn Strategy>>,
}

impl std::fmt::Debug for StrategyEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StrategyEngine")
            .field("strategy_count", &self.strategies.len())
            .finish()
    }
}

impl StrategyEngine {
    pub fn new(strategies: Vec<Arc<dyn Strategy>>) -> Self {
        Self { strategies }
    }

    pub fn evaluate(&self, context: &StrategyContext) -> Result<StrategyDecision, StrategyError> {
        for strategy in &self.strategies {
            match strategy.evaluate(context)? {
                StrategyDecision::NoAction => continue,
                decision @ StrategyDecision::SubmitOrder(_) => return Ok(decision),
            }
        }

        Ok(StrategyDecision::NoAction)
    }
}
