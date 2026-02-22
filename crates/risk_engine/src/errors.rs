#[derive(Clone, Debug)]
pub enum RiskEngineError {
    ConfigurationInvalid,
    SnapshotUnavailable,
    InvariantViolation,
}
