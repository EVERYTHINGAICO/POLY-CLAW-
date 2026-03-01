use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum IntentQueueError {
    #[error("queue poisoned")]
    QueuePoisoned,

    #[error("invalid intent")]
    InvalidIntent,

    #[error("queue full")]
    QueueFull,

    #[error("duplicate idempotency key")]
    DuplicateIdempotencyKey,
}
