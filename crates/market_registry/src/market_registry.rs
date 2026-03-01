use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use sqlx::{Row, SqlitePool};
use storage::models::{Market, MarketToken};
use storage::repos::markets;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;

use crate::cache::MarketCache;
use crate::errors::{MarketRegistryError, Result};
use crate::lifecycle::compute_lifecycle_state;
use crate::models::{GammaMarket, LifecycleState, MarketMetadata, MarketRegistryConfig};
use crate::polymarket_client::PolymarketClient;
use crate::sync::start_sync_loop_task;

#[derive(Default)]
struct RegistryControl {
    initialized: AtomicBool,
    init_lock: Mutex<()>,
    sync_lock: Mutex<()>,
    sync_loop_started: AtomicBool,
}

#[derive(Clone)]
pub struct MarketRegistry {
    pool: SqlitePool,
    client: PolymarketClient,
    cache: Arc<RwLock<MarketCache>>,
    config: MarketRegistryConfig,
    control: Arc<RegistryControl>,
}

impl MarketRegistry {
    pub fn new(pool: SqlitePool, client: PolymarketClient, config: MarketRegistryConfig) -> Self {
        Self {
            pool,
            client,
            cache: Arc::new(RwLock::new(MarketCache::default())),
            config,
            control: Arc::new(RegistryControl::default()),
        }
    }

    pub fn cache(&self) -> Arc<RwLock<MarketCache>> {
        Arc::clone(&self.cache)
    }

    pub fn is_initialized(&self) -> bool {
        self.control.initialized.load(Ordering::Acquire)
    }

    pub async fn bootstrap_from_storage(&self) -> Result<()> {
        // Scope restriction: storage layer is immutable in this phase, so we load
        // from canonical storage tables directly while preserving storage schema.
        let persisted_markets = load_all_markets_from_storage(&self.pool).await?;
        let persisted_tokens = load_all_market_tokens_from_storage(&self.pool).await?;

        let mut tokens_by_market_id = persisted_tokens
            .into_iter()
            .map(|token| (token.market_id.clone(), token))
            .collect::<HashMap<_, _>>();

        let mut rebuilt = MarketCache::default();
        for persisted_market in persisted_markets {
            let token = tokens_by_market_id.remove(&persisted_market.market_id);
            let metadata = metadata_from_storage(persisted_market, token);
            rebuilt.last_sync_ts_ms = rebuilt
                .last_sync_ts_ms
                .max(metadata.market.last_refreshed_ts_ms);
            rebuilt.upsert_market(metadata);
        }

        let mut cache_guard = self.cache.write().await;
        *cache_guard = rebuilt;
        self.control.initialized.store(true, Ordering::Release);
        Ok(())
    }

    pub async fn initialize(&self) -> Result<()> {
        if self.control.initialized.load(Ordering::Acquire) {
            return Ok(());
        }

        let _init_guard = self.control.init_lock.lock().await;
        if self.control.initialized.load(Ordering::Acquire) {
            return Ok(());
        }

        self.bootstrap_from_storage().await?;
        self.sync_all_markets().await?;
        self.control.initialized.store(true, Ordering::Release);
        Ok(())
    }

    pub fn start_sync_loop(self: Arc<Self>, interval: Option<Duration>) -> Option<JoinHandle<()>> {
        if self
            .control
            .sync_loop_started
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return None;
        }

        let refresh_interval =
            interval.unwrap_or(Duration::from_millis(self.config.refresh_interval_ms));
        Some(start_sync_loop_task(self, refresh_interval))
    }

    pub async fn initialize_and_start(
        self: Arc<Self>,
        interval: Option<Duration>,
    ) -> Result<Option<JoinHandle<()>>> {
        self.initialize().await?;
        Ok(self.start_sync_loop(interval))
    }

    pub async fn sync_all_markets(&self) -> Result<usize> {
        let _sync_guard = self.control.sync_lock.lock().await;
        let gamma_markets = self.client.fetch_markets().await?;
        let now_ts_ms = now_ts_ms();

        let previous_markets = {
            let guard = self.cache.read().await;
            guard.markets.clone()
        };

        let mut normalized = Vec::with_capacity(gamma_markets.len());
        for gamma_market in gamma_markets {
            let previous_metadata = previous_markets.get(&gamma_market.id);
            if let Some(metadata) = normalize_market(
                gamma_market,
                previous_metadata,
                now_ts_ms,
                self.config.closing_buffer_seconds,
            )? {
                normalized.push(metadata);
            }
        }

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|error| MarketRegistryError::Storage(error.to_string()))?;

        for metadata in &normalized {
            markets::upsert_market(&mut *tx, &metadata.market)
                .await
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?;

            if let Some(token) = metadata.market_token.as_ref() {
                markets::upsert_market_token(&mut *tx, token)
                    .await
                    .map_err(|error| MarketRegistryError::Storage(error.to_string()))?;
            }
        }

        tx.commit()
            .await
            .map_err(|error| MarketRegistryError::Storage(error.to_string()))?;

        let mut cache = self.cache.write().await;
        for metadata in normalized {
            cache.upsert_market(metadata);
        }
        cache.last_sync_ts_ms = now_ts_ms;
        self.control.initialized.store(true, Ordering::Release);

        Ok(cache.markets.len())
    }

    pub async fn get_market(&self, market_id: &str) -> Result<Option<MarketMetadata>> {
        self.ensure_initialized().await?;
        let cache = self.cache.read().await;
        Ok(cache.markets.get(market_id).cloned())
    }

    pub async fn get_tradable_markets(&self) -> Result<Vec<MarketMetadata>> {
        self.ensure_initialized().await?;
        let cache = self.cache.read().await;
        Ok(cache
            .markets
            .values()
            .filter(|metadata| Self::metadata_tradable(metadata))
            .cloned()
            .collect())
    }

    pub async fn get_market_by_token(&self, token_id: &str) -> Result<Option<MarketMetadata>> {
        self.ensure_initialized().await?;
        let cache = self.cache.read().await;
        Ok(cache.get_market_by_token(token_id).cloned())
    }

    pub async fn is_market_tradable(&self, market_id: &str) -> Result<bool> {
        self.ensure_initialized().await?;
        let cache = self.cache.read().await;
        Ok(cache
            .markets
            .get(market_id)
            .map(Self::metadata_tradable)
            .unwrap_or(false))
    }

    async fn ensure_initialized(&self) -> Result<()> {
        if self.control.initialized.load(Ordering::Acquire) {
            return Ok(());
        }
        self.initialize().await
    }

    fn metadata_tradable(metadata: &MarketMetadata) -> bool {
        metadata.market.active
            && !metadata.market.closed
            && !metadata.market.resolved
            && metadata.token_mapping_valid
    }
}

fn normalize_market(
    gamma: GammaMarket,
    previous_metadata: Option<&MarketMetadata>,
    now_ts_ms: i64,
    closing_buffer_seconds: i64,
) -> Result<Option<MarketMetadata>> {
    if gamma.id.trim().is_empty() {
        return Ok(None);
    }

    let end_time_ts_ms = gamma
        .end_date
        .as_deref()
        .and_then(parse_rfc3339_to_unix_ms)
        .unwrap_or(0);

    let volume = parse_optional_f64(gamma.volume.as_ref());
    let liquidity = parse_optional_f64(gamma.liquidity.as_ref());

    let category = gamma.category.clone().or_else(|| {
        gamma.events.as_ref().and_then(|events| {
            events
                .iter()
                .find_map(|event| event.category.as_ref().cloned())
        })
    });

    let parsed_tokens =
        parse_yes_no_tokens(gamma.clob_token_ids.as_ref(), gamma.outcomes.as_ref())?;

    let previous_yes = previous_metadata.and_then(|metadata| metadata.market.yes_token_id.clone());
    let previous_no = previous_metadata.and_then(|metadata| metadata.market.no_token_id.clone());

    // Preserve prior mapping when upstream payload omits token ids, so expired/closed
    // markets remain resolvable and queryable.
    let yes_token_id = parsed_tokens.0.or(previous_yes);
    let no_token_id = parsed_tokens.1.or(previous_no);

    let has_complete_mapping =
        has_complete_mapping(yes_token_id.as_deref(), no_token_id.as_deref());

    let previous_state = previous_metadata
        .and_then(|metadata| LifecycleState::from_str(metadata.market.lifecycle_state.as_str()));

    let lifecycle_state = compute_lifecycle_state(
        previous_state,
        gamma.active,
        gamma.closed,
        gamma.resolved,
        gamma.archived,
        end_time_ts_ms,
        now_ts_ms,
        closing_buffer_seconds,
        has_complete_mapping,
    );

    let tick_size = parse_optional_f64(gamma.tick_size.as_ref())
        .or_else(|| parse_optional_f64(gamma.minimum_tick_size.as_ref()))
        .or_else(|| previous_metadata.and_then(|metadata| metadata.market.tick_size));
    let min_order_size = parse_optional_f64(gamma.min_order_size.as_ref())
        .or_else(|| parse_optional_f64(gamma.minimum_order_size.as_ref()))
        .or_else(|| previous_metadata.and_then(|metadata| metadata.market.min_order_size));

    let market = Market {
        market_id: gamma.id.clone(),
        question: gamma.question,
        category,
        tags_json: None,
        end_time_ts_ms,
        status: market_status(gamma.active, gamma.closed, gamma.resolved),
        active: gamma.active,
        closed: gamma.closed,
        resolved: gamma.resolved,
        volume,
        liquidity,
        yes_token_id: yes_token_id.clone(),
        no_token_id: no_token_id.clone(),
        tick_size,
        min_order_size,
        fee_model: None,
        lifecycle_state: lifecycle_state.as_str().to_string(),
        last_refreshed_ts_ms: now_ts_ms,
    };

    let market_token = if has_complete_mapping {
        Some(MarketToken {
            market_id: gamma.id,
            yes_token_id: yes_token_id.clone().unwrap_or_default(),
            no_token_id: no_token_id.clone().unwrap_or_default(),
            tick_size: tick_size.unwrap_or_default(),
            min_order_size: min_order_size.unwrap_or_default(),
            price_min: previous_metadata
                .and_then(|metadata| metadata.market_token.as_ref().map(|token| token.price_min))
                .unwrap_or(0.0),
            price_max: previous_metadata
                .and_then(|metadata| metadata.market_token.as_ref().map(|token| token.price_max))
                .unwrap_or(1.0),
            fee_bps: parse_optional_i64(gamma.fee_bps.as_ref())
                .or_else(|| {
                    previous_metadata.and_then(|metadata| {
                        metadata.market_token.as_ref().map(|token| token.fee_bps)
                    })
                })
                .unwrap_or_default(),
            source: "gamma_api".to_string(),
            last_refreshed_ts_ms: now_ts_ms,
            valid: true,
        })
    } else {
        None
    };

    Ok(Some(MarketMetadata {
        market,
        market_token,
        token_mapping_valid: has_complete_mapping,
    }))
}

fn metadata_from_storage(mut market: Market, market_token: Option<MarketToken>) -> MarketMetadata {
    let token_mapping_valid = has_complete_mapping(
        market.yes_token_id.as_deref(),
        market.no_token_id.as_deref(),
    ) && market_token
        .as_ref()
        .map(|token| has_complete_mapping(Some(&token.yes_token_id), Some(&token.no_token_id)))
        .unwrap_or(false);

    if !token_mapping_valid {
        market.yes_token_id = None;
        market.no_token_id = None;
    }

    MarketMetadata {
        market,
        market_token,
        token_mapping_valid,
    }
}

fn has_complete_mapping(yes_token_id: Option<&str>, no_token_id: Option<&str>) -> bool {
    matches!((yes_token_id, no_token_id), (Some(yes), Some(no)) if !yes.is_empty() && !no.is_empty())
}

async fn load_all_markets_from_storage(pool: &SqlitePool) -> Result<Vec<Market>> {
    let rows = sqlx::query(
        r#"
        SELECT
            market_id,
            question,
            category,
            tags_json,
            end_time_ts_ms,
            status,
            active,
            closed,
            resolved,
            volume,
            liquidity,
            yes_token_id,
            no_token_id,
            tick_size,
            min_order_size,
            fee_model,
            lifecycle_state,
            last_refreshed_ts_ms
        FROM markets
        ORDER BY market_id
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|error| MarketRegistryError::Storage(error.to_string()))?;

    let mut markets = Vec::with_capacity(rows.len());
    for row in rows {
        let market = Market {
            market_id: row
                .try_get("market_id")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            question: row
                .try_get("question")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            category: row
                .try_get("category")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            tags_json: row
                .try_get("tags_json")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            end_time_ts_ms: row
                .try_get("end_time_ts_ms")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            status: row
                .try_get("status")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            active: row
                .try_get("active")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            closed: row
                .try_get("closed")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            resolved: row
                .try_get("resolved")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            volume: row
                .try_get("volume")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            liquidity: row
                .try_get("liquidity")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            yes_token_id: row
                .try_get("yes_token_id")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            no_token_id: row
                .try_get("no_token_id")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            tick_size: row
                .try_get("tick_size")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            min_order_size: row
                .try_get("min_order_size")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            fee_model: row
                .try_get("fee_model")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            lifecycle_state: row
                .try_get("lifecycle_state")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            last_refreshed_ts_ms: row
                .try_get("last_refreshed_ts_ms")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
        };
        markets.push(market);
    }

    Ok(markets)
}

async fn load_all_market_tokens_from_storage(pool: &SqlitePool) -> Result<Vec<MarketToken>> {
    let rows = sqlx::query(
        r#"
        SELECT
            market_id,
            yes_token_id,
            no_token_id,
            tick_size,
            min_order_size,
            price_min,
            price_max,
            fee_bps,
            source,
            last_refreshed_ts_ms,
            valid
        FROM market_tokens
        ORDER BY market_id
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|error| MarketRegistryError::Storage(error.to_string()))?;

    let mut tokens = Vec::with_capacity(rows.len());
    for row in rows {
        let token = MarketToken {
            market_id: row
                .try_get("market_id")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            yes_token_id: row
                .try_get("yes_token_id")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            no_token_id: row
                .try_get("no_token_id")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            tick_size: row
                .try_get("tick_size")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            min_order_size: row
                .try_get("min_order_size")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            price_min: row
                .try_get("price_min")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            price_max: row
                .try_get("price_max")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            fee_bps: row
                .try_get("fee_bps")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            source: row
                .try_get("source")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            last_refreshed_ts_ms: row
                .try_get("last_refreshed_ts_ms")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
            valid: row
                .try_get("valid")
                .map_err(|error| MarketRegistryError::Storage(error.to_string()))?,
        };
        tokens.push(token);
    }

    Ok(tokens)
}

fn parse_rfc3339_to_unix_ms(input: &str) -> Option<i64> {
    OffsetDateTime::parse(input, &Rfc3339)
        .ok()
        .map(|dt| dt.unix_timestamp_nanos() / 1_000_000)
        .map(|ms| ms as i64)
}

fn parse_yes_no_tokens(
    clob_token_ids: Option<&String>,
    outcomes: Option<&String>,
) -> Result<(Option<String>, Option<String>)> {
    let Some(clob_token_ids) = clob_token_ids else {
        return Ok((None, None));
    };

    let token_ids: Vec<String> = serde_json::from_str(clob_token_ids)?;
    if token_ids.len() < 2 {
        return Ok((None, None));
    }

    let mut yes_index = Some(0usize);
    let mut no_index = Some(1usize);

    if let Some(outcomes_json) = outcomes {
        let parsed_outcomes: Vec<String> = serde_json::from_str(outcomes_json)?;
        let yes = parsed_outcomes
            .iter()
            .position(|outcome| outcome.eq_ignore_ascii_case("yes"));
        let no = parsed_outcomes
            .iter()
            .position(|outcome| outcome.eq_ignore_ascii_case("no"));
        if yes.is_some() && no.is_some() {
            yes_index = yes;
            no_index = no;
        }
    }

    let yes_token_id = yes_index.and_then(|index| token_ids.get(index).cloned());
    let no_token_id = no_index.and_then(|index| token_ids.get(index).cloned());

    if has_complete_mapping(yes_token_id.as_deref(), no_token_id.as_deref()) {
        Ok((yes_token_id, no_token_id))
    } else {
        Ok((None, None))
    }
}

fn parse_optional_f64(value: Option<&serde_json::Value>) -> Option<f64> {
    match value {
        Some(serde_json::Value::Number(number)) => number.as_f64(),
        Some(serde_json::Value::String(text)) => text.parse::<f64>().ok(),
        _ => None,
    }
}

fn parse_optional_i64(value: Option<&serde_json::Value>) -> Option<i64> {
    match value {
        Some(serde_json::Value::Number(number)) => number.as_i64(),
        Some(serde_json::Value::String(text)) => text.parse::<i64>().ok(),
        _ => None,
    }
}

fn market_status(active: bool, closed: bool, resolved: bool) -> String {
    if resolved {
        "RESOLVED".to_string()
    } else if closed {
        "CLOSED".to_string()
    } else if active {
        "ACTIVE".to_string()
    } else {
        "INACTIVE".to_string()
    }
}

fn now_ts_ms() -> i64 {
    OffsetDateTime::now_utc().unix_timestamp_nanos() as i64 / 1_000_000
}
