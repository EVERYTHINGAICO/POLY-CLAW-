#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FillListenerError {
    SourceUnavailable,
    InvalidFillEvent,
    InvariantViolation,
}
