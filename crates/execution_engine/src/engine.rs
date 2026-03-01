use std::sync::Arc;

use fill_listener::types::FillEvent;
use reconciliation::engine::ReconciliationEngine;

use crate::coordinator::ExecutionCoordinator;
use crate::errors::ExecutionEngineError;
use crate::execution_context::ExecutionContext;
use crate::traits::ExecutionEngine;
use crate::types::{ExecutionId, OrderId};

#[derive(Clone, Debug)]
pub struct PolymarketExecutionEngine {
    coordinator: Arc<ExecutionCoordinator>,
    reconciliation_engine: Arc<ReconciliationEngine>,
}

impl PolymarketExecutionEngine {
    pub fn new(
        coordinator: Arc<ExecutionCoordinator>,
        reconciliation_engine: Arc<ReconciliationEngine>,
    ) -> Self {
        Self {
            coordinator,
            reconciliation_engine,
        }
    }

    pub async fn process_fill_event(&self, fill: &FillEvent) -> Result<(), ExecutionEngineError> {
        if fill.fill_id.is_empty()
            || fill.order_id.is_empty()
            || fill.market_id.is_empty()
            || fill.token_id.is_empty()
            || !fill.price.is_finite()
            || fill.size <= 0.0
            || fill.exchange_ts_ms == 0
            || fill.ingest_ts_ms == 0
        {
            return Err(ExecutionEngineError::InvalidFillEvent(fill.fill_id.clone()));
        }

        self.reconciliation_engine
            .reconcile_fill(fill)
            .await
            .map_err(|err| ExecutionEngineError::ReconciliationFailure(err.to_string()))?;

        Ok(())
    }
}

#[async_trait::async_trait]
impl ExecutionEngine for PolymarketExecutionEngine {
    async fn submit_order(
        &self,
        context: ExecutionContext,
    ) -> Result<ExecutionId, ExecutionEngineError> {
        let order_id = context.order_id.clone();
        self.coordinator.submit_execution(context)?;
        self.coordinator.mark_submitted(&order_id)?;
        let execution_id = ExecutionId::new(uuid::Uuid::new_v4().to_string());

        Ok(execution_id)
    }

    async fn cancel_order(&self, order_id: OrderId) -> Result<(), ExecutionEngineError> {
        self.coordinator.mark_cancel_requested(&order_id)
    }
}
