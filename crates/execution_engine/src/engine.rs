use std::sync::Arc;

use crate::coordinator::ExecutionCoordinator;
use crate::errors::ExecutionEngineError;
use crate::execution_context::ExecutionContext;
use crate::traits::ExecutionEngine;
use crate::types::{ExecutionId, OrderId};

#[derive(Clone, Debug)]
pub struct PolymarketExecutionEngine {
    coordinator: Arc<ExecutionCoordinator>,
}

impl PolymarketExecutionEngine {
    pub fn new(coordinator: Arc<ExecutionCoordinator>) -> Self {
        Self { coordinator }
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
