use std::time::Duration;

use reqwest::{Client, StatusCode};

use crate::errors::{MarketRegistryError, Result};
use crate::models::{GammaMarket, GammaMarketsResponse};

const DEFAULT_BASE_URL: &str = "https://gamma-api.polymarket.com";
const REQUEST_TIMEOUT_SECS: u64 = 5;
const RETRY_BACKOFF_SECS: [u64; 5] = [1, 2, 4, 8, 16];
const MAX_BACKOFF_SECS: u64 = 30;

#[derive(Clone)]
pub struct PolymarketClient {
    base_url: String,
    http: Client,
}

impl PolymarketClient {
    pub fn new(base_url: impl Into<String>) -> Result<Self> {
        let http = Client::builder()
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()?;

        Ok(Self {
            base_url: base_url.into(),
            http,
        })
    }

    pub fn with_default_base_url() -> Result<Self> {
        Self::new(DEFAULT_BASE_URL)
    }

    pub async fn fetch_markets(&self) -> Result<Vec<GammaMarket>> {
        let mut all_markets = Vec::new();
        let mut offset: usize = 0;
        let limit: usize = 500;

        loop {
            let url = format!("{}/markets?limit={limit}&offset={offset}", self.base_url);
            let page = self.fetch_markets_page(&url).await?;

            if page.is_empty() {
                break;
            }

            let page_len = page.len();
            all_markets.extend(page);

            if page_len < limit {
                break;
            }

            offset += limit;
        }

        Ok(all_markets)
    }

    async fn fetch_markets_page(&self, url: &str) -> Result<Vec<GammaMarket>> {
        let mut attempt = 0usize;

        loop {
            let response_result = self.http.get(url).send().await;

            match response_result {
                Ok(response) if response.status().is_success() => {
                    let body = response.text().await?;
                    let parsed: GammaMarketsResponse = serde_json::from_str(&body)?;
                    return Ok(parsed.into_markets());
                }
                Ok(response) => {
                    let status = response.status();
                    let headers = response.headers().clone();
                    let body = response.text().await.unwrap_or_default();
                    let retry_after = headers
                        .get("Retry-After")
                        .and_then(|value| value.to_str().ok())
                        .and_then(|value| value.parse::<u64>().ok());

                    let error_message =
                        format!("gamma markets request failed with status {status}, body={body}");

                    if !is_retryable_status(status) {
                        return Err(MarketRegistryError::RetryExhausted {
                            attempts: attempt + 1,
                            message: error_message,
                        });
                    }

                    if attempt >= RETRY_BACKOFF_SECS.len() {
                        return Err(MarketRegistryError::RetryExhausted {
                            attempts: attempt + 1,
                            message: error_message,
                        });
                    }

                    let sleep_secs = retry_after
                        .unwrap_or(RETRY_BACKOFF_SECS[attempt])
                        .min(MAX_BACKOFF_SECS);
                    tokio::time::sleep(Duration::from_secs(sleep_secs)).await;
                    attempt += 1;
                }
                Err(error) => {
                    let error_message = error.to_string();

                    if attempt >= RETRY_BACKOFF_SECS.len() {
                        return Err(MarketRegistryError::RetryExhausted {
                            attempts: attempt + 1,
                            message: error_message,
                        });
                    }

                    let sleep_secs = RETRY_BACKOFF_SECS[attempt].min(MAX_BACKOFF_SECS);
                    tokio::time::sleep(Duration::from_secs(sleep_secs)).await;
                    attempt += 1;
                }
            }
        }
    }
}

fn is_retryable_status(status: StatusCode) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}
