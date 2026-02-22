#[derive(Debug, thiserror::Error)]
pub enum ConfigurationError {
    #[error("invalid configuration")]
    InvalidConfiguration,
    #[error("missing field")]
    MissingField,
    #[error("parse error")]
    ParseError,
    #[error("internal error: {0}")]
    InternalError(String),
}
