use anyhow::{Context, Result};
use sqlx::{Sqlite, SqliteExecutor, Transaction};

use crate::models::FundsLedgerEntry;

pub async fn append_ledger_entry<'e, E>(executor: E, entry: &FundsLedgerEntry) -> Result<()>
where
    E: SqliteExecutor<'e>,
{
    sqlx::query(
        r#"
        INSERT INTO funds_ledger (
            ledger_entry_id,
            event_type,
            order_id,
            market_id,
            delta_available,
            delta_locked,
            delta_reserved,
            delta_settlement_pending,
            total_balance,
            available_balance,
            locked_balance,
            reserved_balance,
            settlement_pending_balance,
            reason,
            ts_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&entry.ledger_entry_id)
    .bind(&entry.event_type)
    .bind(&entry.order_id)
    .bind(&entry.market_id)
    .bind(entry.delta_available)
    .bind(entry.delta_locked)
    .bind(entry.delta_reserved)
    .bind(entry.delta_settlement_pending)
    .bind(entry.total_balance)
    .bind(entry.available_balance)
    .bind(entry.locked_balance)
    .bind(entry.reserved_balance)
    .bind(entry.settlement_pending_balance)
    .bind(&entry.reason)
    .bind(entry.ts_ms)
    .execute(executor)
    .await
    .context("failed to append funds ledger entry")?;

    Ok(())
}

pub async fn append_ledger_entry_tx(
    tx: &mut Transaction<'_, Sqlite>,
    entry: &FundsLedgerEntry,
) -> Result<()> {
    append_ledger_entry(&mut **tx, entry).await
}
