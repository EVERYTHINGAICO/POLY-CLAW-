use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ReconciliationError {
    #[error("invalid fill event")]
    InvalidFillEvent,

    #[error("timestamp overflow")]
    TimestampOverflow,

    #[error("storage failure: {0}")]
    StorageFailure(String),
}
