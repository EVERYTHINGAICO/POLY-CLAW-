use anyhow::{Context, Result};
use sqlx::{Sqlite, SqliteExecutor, Transaction};

use crate::models::Position;

pub async fn upsert_position<'e, E>(executor: E, position: &Position) -> Result<()>
where
    E: SqliteExecutor<'e>,
{
    sqlx::query(
        r#"
        INSERT INTO positions (
            market_id,
            yes_qty,
            no_qty,
            avg_price_yes,
            avg_price_no,
            realized_pnl,
            unrealized_pnl,
            status,
            updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(market_id) DO UPDATE SET
            yes_qty = excluded.yes_qty,
            no_qty = excluded.no_qty,
            avg_price_yes = excluded.avg_price_yes,
            avg_price_no = excluded.avg_price_no,
            realized_pnl = excluded.realized_pnl,
            unrealized_pnl = excluded.unrealized_pnl,
            status = excluded.status,
            updated_at_ms = excluded.updated_at_ms
        "#,
    )
    .bind(&position.market_id)
    .bind(position.yes_qty)
    .bind(position.no_qty)
    .bind(position.avg_price_yes)
    .bind(position.avg_price_no)
    .bind(position.realized_pnl)
    .bind(position.unrealized_pnl)
    .bind(&position.status)
    .bind(position.updated_at_ms)
    .execute(executor)
    .await
    .context("failed to upsert position")?;

    Ok(())
}

pub async fn upsert_position_tx(
    tx: &mut Transaction<'_, Sqlite>,
    position: &Position,
) -> Result<()> {
    upsert_position(&mut **tx, position).await
}
