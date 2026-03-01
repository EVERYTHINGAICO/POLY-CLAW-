use std::pin::Pin;
use std::sync::Arc;

use fill_listener::types::{FillEvent, FillSide};
use storage::atomic::{apply_fill_atomically, ApplyFillResult};
use storage::db::Database;
use storage::models::Fill;

use crate::errors::ReconciliationError;
use crate::logger::{
    log_duplicate_ignored, log_fill_persisted, log_fill_received, log_storage_failure,
};
use crate::types::ReconcileOutcome;

#[derive(Clone)]
pub struct ReconciliationEngine {
    db: Arc<Database>,
}

impl std::fmt::Debug for ReconciliationEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ReconciliationEngine").finish()
    }
}

impl ReconciliationEngine {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub async fn reconcile_fill(
        &self,
        event: &FillEvent,
    ) -> Result<ReconcileOutcome, ReconciliationError> {
        log_fill_received(event);

        let fill = map_fill_event(event)?;
        let result = self
            .db
            .atomic(move |tx| {
                Box::pin(async move { apply_fill_atomically(tx, &fill).await }) as Pin<_>
            })
            .await
            .map_err(|err| {
                log_storage_failure(&event.fill_id);
                ReconciliationError::StorageFailure(err.to_string())
            })?;

        let outcome = outcome_from_apply_result(&result);
        if result.already_applied {
            log_duplicate_ignored(&event.fill_id);
        } else {
            log_fill_persisted(&event.fill_id);
        }

        Ok(outcome)
    }

    pub async fn reconcile_batch(
        &self,
        events: &[FillEvent],
    ) -> Result<ReconcileOutcome, ReconciliationError> {
        for event in events {
            log_fill_received(event);
        }

        let fills: Vec<Fill> = events
            .iter()
            .map(map_fill_event)
            .collect::<Result<Vec<_>, ReconciliationError>>()?;

        let results: Vec<ApplyFillResult> = self
            .db
            .atomic(move |tx| {
                Box::pin(async move {
                    let mut applied = Vec::with_capacity(fills.len());
                    for fill in &fills {
                        applied.push(apply_fill_atomically(tx, fill).await?);
                    }
                    Ok(applied)
                }) as Pin<_>
            })
            .await
            .map_err(|err| {
                let fill_id = events
                    .first()
                    .map(|e| e.fill_id.as_str())
                    .unwrap_or("<empty-batch>");
                log_storage_failure(fill_id);
                ReconciliationError::StorageFailure(err.to_string())
            })?;

        let mut outcome = ReconcileOutcome::default();
        for (event, result) in events.iter().zip(results.iter()) {
            let single = outcome_from_apply_result(result);
            outcome.merge(&single);
            if result.already_applied {
                log_duplicate_ignored(&event.fill_id);
            } else {
                log_fill_persisted(&event.fill_id);
            }
        }

        Ok(outcome)
    }
}

fn outcome_from_apply_result(result: &ApplyFillResult) -> ReconcileOutcome {
    ReconcileOutcome {
        fills_processed: 1,
        fills_inserted: if result.already_applied { 0 } else { 1 },
        duplicates_ignored: if result.already_applied { 1 } else { 0 },
        cursor_advanced_count: if result.cursor_advanced { 1 } else { 0 },
    }
}

fn map_fill_event(event: &FillEvent) -> Result<Fill, ReconciliationError> {
    if event.fill_id.is_empty()
        || event.order_id.is_empty()
        || event.market_id.is_empty()
        || event.token_id.is_empty()
    {
        return Err(ReconciliationError::InvalidFillEvent);
    }

    if !event.price.is_finite() || !event.size.is_finite() || event.price < 0.0 || event.size <= 0.0
    {
        return Err(ReconciliationError::InvalidFillEvent);
    }

    let exchange_ts_ms =
        i64::try_from(event.exchange_ts_ms).map_err(|_| ReconciliationError::TimestampOverflow)?;
    let ingest_ts_ms =
        i64::try_from(event.ingest_ts_ms).map_err(|_| ReconciliationError::TimestampOverflow)?;

    let side = match event.side {
        FillSide::Buy => "BUY".to_string(),
        FillSide::Sell => "SELL".to_string(),
    };

    Ok(Fill {
        fill_id: event.fill_id.clone(),
        exchange_fill_id: event.fill_id.clone(),
        order_id: event.order_id.clone(),
        exchange_order_id: None,
        market_id: event.market_id.clone(),
        token_id: event.token_id.clone(),
        side,
        price: event.price,
        size: event.size,
        fee_usdc: event.fee_usdc,
        liquidity: None,
        exchange_ts_ms,
        ingest_ts_ms,
        raw_json: event.raw_json.clone(),
    })
}
