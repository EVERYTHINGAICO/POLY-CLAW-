#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StrategyError {
    InvalidContext,
    InvalidDecision,
    InvariantViolation,
}
