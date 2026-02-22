use anyhow::{Context, Result};
use sqlx::{Sqlite, SqliteExecutor, SqlitePool, Transaction};

use crate::models::{Fill, FundsLedgerEntry, Position};
use crate::tx;

use super::{ledger, positions};

pub async fn insert_fill_if_not_exists<'e, E>(executor: E, fill: &Fill) -> Result<bool>
where
    E: SqliteExecutor<'e>,
{
    let result = sqlx::query(
        r#"
        INSERT INTO fills (
            fill_id,
            exchange_fill_id,
            order_id,
            exchange_order_id,
            market_id,
            token_id,
            side,
            price,
            size,
            fee_usdc,
            liquidity,
            exchange_ts_ms,
            ingest_ts_ms,
            raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(&fill.fill_id)
    .bind(&fill.exchange_fill_id)
    .bind(&fill.order_id)
    .bind(&fill.exchange_order_id)
    .bind(&fill.market_id)
    .bind(&fill.token_id)
    .bind(&fill.side)
    .bind(fill.price)
    .bind(fill.size)
    .bind(fill.fee_usdc)
    .bind(&fill.liquidity)
    .bind(fill.exchange_ts_ms)
    .bind(fill.ingest_ts_ms)
    .bind(&fill.raw_json)
    .execute(executor)
    .await
    .context("failed to insert fill")?;

    Ok(result.rows_affected() > 0)
}

pub async fn insert_fill_tx(tx: &mut Transaction<'_, Sqlite>, fill: &Fill) -> Result<bool> {
    insert_fill_if_not_exists(&mut **tx, fill).await
}

pub async fn ingest_fill_atomic(
    pool: &SqlitePool,
    fill: &Fill,
    position: &Position,
    ledger_entry: &FundsLedgerEntry,
) -> Result<bool> {
    let mut tx = tx::begin_immediate(pool)
        .await
        .context("failed to begin fill ingestion transaction")?;

    let inserted = insert_fill_tx(&mut tx.tx, fill).await?;
    if inserted {
        positions::upsert_position_tx(&mut tx.tx, position).await?;
        ledger::append_ledger_entry_tx(&mut tx.tx, ledger_entry).await?;
    }

    tx.commit()
        .await
        .context("failed to commit fill ingestion transaction")?;

    Ok(inserted)
}
