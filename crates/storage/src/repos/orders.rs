use anyhow::{Context, Result};
use sqlx::{Sqlite, SqliteExecutor, Transaction};

use crate::models::OpenOrder;

pub async fn upsert_open_order<'e, E>(executor: E, order: &OpenOrder) -> Result<()>
where
    E: SqliteExecutor<'e>,
{
    sqlx::query(
        r#"
        INSERT INTO open_orders (
            order_id,
            client_order_id,
            exchange_order_id,
            strategy_id,
            market_id,
            token_id,
            side,
            price,
            size,
            filled_size,
            status,
            created_at_ms,
            updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(order_id) DO UPDATE SET
            client_order_id = excluded.client_order_id,
            exchange_order_id = excluded.exchange_order_id,
            strategy_id = excluded.strategy_id,
            market_id = excluded.market_id,
            token_id = excluded.token_id,
            side = excluded.side,
            price = excluded.price,
            size = excluded.size,
            filled_size = excluded.filled_size,
            status = excluded.status,
            updated_at_ms = excluded.updated_at_ms
        "#,
    )
    .bind(&order.order_id)
    .bind(&order.client_order_id)
    .bind(&order.exchange_order_id)
    .bind(&order.strategy_id)
    .bind(&order.market_id)
    .bind(&order.token_id)
    .bind(&order.side)
    .bind(order.price)
    .bind(order.size)
    .bind(order.filled_size)
    .bind(&order.status)
    .bind(order.created_at_ms)
    .bind(order.updated_at_ms)
    .execute(executor)
    .await
    .context("failed to upsert open order")?;

    Ok(())
}

pub async fn update_order_status<'e, E>(
    executor: E,
    order_id: &str,
    status: &str,
    filled_size: f64,
    updated_at_ms: i64,
) -> Result<u64>
where
    E: SqliteExecutor<'e>,
{
    let result = sqlx::query(
        r#"
        UPDATE open_orders
        SET status = ?,
            filled_size = ?,
            updated_at_ms = ?
        WHERE order_id = ?
        "#,
    )
    .bind(status)
    .bind(filled_size)
    .bind(updated_at_ms)
    .bind(order_id)
    .execute(executor)
    .await
    .context("failed to update open order status")?;

    Ok(result.rows_affected())
}

pub async fn upsert_open_order_tx(
    tx: &mut Transaction<'_, Sqlite>,
    order: &OpenOrder,
) -> Result<()> {
    upsert_open_order(&mut **tx, order).await
}

pub async fn update_order_status_tx(
    tx: &mut Transaction<'_, Sqlite>,
    order_id: &str,
    status: &str,
    filled_size: f64,
    updated_at_ms: i64,
) -> Result<u64> {
    update_order_status(&mut **tx, order_id, status, filled_size, updated_at_ms).await
}
