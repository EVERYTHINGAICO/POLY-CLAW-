use thiserror::Error;

#[derive(Debug, Error)]
pub enum MarketRegistryError {
    #[error("http request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("json decode failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("retry exhausted after {attempts} attempts: {message}")]
    RetryExhausted { attempts: usize, message: String },
    #[error("storage error: {0}")]
    Storage(String),
    #[error("normalization error: {0}")]
    Normalization(String),
    #[error("initialization error: {0}")]
    Initialization(String),
}

pub type Result<T> = std::result::Result<T, MarketRegistryError>;
