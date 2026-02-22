#[derive(Debug, thiserror::Error)]
pub enum ExecutionEngineError {
    #[error("invalid state transition")]
    InvalidStateTransition,

    #[error("invalid order")]
    InvalidOrder,

    #[error("invalid quantity")]
    InvalidQuantity,

    #[error("invalid price")]
    InvalidPrice,

    #[error("market not tradable")]
    MarketNotTradable,

    #[error("execution rejected")]
    ExecutionRejected,

    #[error("risk rejected: {0:?}")]
    RiskRejected(risk_engine::types::RiskRejectionReason),

    #[error("execution failed")]
    ExecutionFailed,

    #[error("internal error: {0}")]
    InternalError(String),
}
