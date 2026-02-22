use anyhow::{Context, Result};
use sqlx::SqliteExecutor;

use crate::models::ExecutionIntent;

pub async fn enqueue_intent<'e, E>(executor: E, intent: &ExecutionIntent) -> Result<bool>
where
    E: SqliteExecutor<'e>,
{
    let result = sqlx::query(
        r#"
        INSERT INTO execution_intents (
            intent_id,
            ts_ms,
            market_id,
            intent_type,
            payload_json,
            state,
            idempotency_key,
            last_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(idempotency_key) DO NOTHING
        "#,
    )
    .bind(&intent.intent_id)
    .bind(intent.ts_ms)
    .bind(&intent.market_id)
    .bind(&intent.intent_type)
    .bind(&intent.payload_json)
    .bind(&intent.state)
    .bind(&intent.idempotency_key)
    .bind(&intent.last_error)
    .execute(executor)
    .await
    .context("failed to enqueue execution intent")?;

    Ok(result.rows_affected() > 0)
}
