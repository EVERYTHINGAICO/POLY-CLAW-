use crate::errors::ExecutionEngineError;
use crate::execution_context::ExecutionContext;
use crate::types::{ExecutionId, OrderId};

#[async_trait::async_trait]
pub trait ExecutionEngine {
    async fn submit_order(
        &self,
        context: ExecutionContext,
    ) -> Result<ExecutionId, ExecutionEngineError>;

    async fn cancel_order(&self, order_id: OrderId) -> Result<(), ExecutionEngineError>;
}
