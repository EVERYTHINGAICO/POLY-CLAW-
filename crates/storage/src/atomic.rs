use anyhow::{anyhow, Context, Result};
use sqlx::{Sqlite, Transaction};
use uuid::Uuid;

use crate::models::{Fill, FundsLedgerEntry, Position};
use crate::repos::{fills, ledger, orders, positions};

const FP_TOLERANCE: f64 = 1e-9;

#[derive(Debug, Clone)]
pub struct ApplyFillResult {
    pub already_applied: bool,
    pub order_filled_size: Option<f64>,
    pub order_status: Option<String>,
    pub position_updated: bool,
    pub ledger_entry_id: Option<String>,
    pub cursor_advanced: bool,
}

#[derive(Debug, Clone)]
struct LedgerSnapshot {
    total_balance: f64,
    available_balance: f64,
    locked_balance: f64,
    reserved_balance: f64,
    settlement_pending_balance: f64,
}

pub async fn apply_fill_atomically(
    tx: &mut Transaction<'_, Sqlite>,
    fill: &Fill,
) -> Result<ApplyFillResult> {
    let inserted = fills::insert_fill_tx(tx, fill).await?;

    if !inserted {
        advance_fill_cursor_atomically(tx, fill.exchange_ts_ms, Some(fill.fill_id.as_str())).await?;
        return Ok(ApplyFillResult {
            already_applied: true,
            order_filled_size: None,
            order_status: None,
            position_updated: false,
            ledger_entry_id: None,
            cursor_advanced: true,
        });
    }

    let (order_size, current_filled): (f64, f64) = sqlx::query_as(
        r#"
        SELECT size, filled_size
        FROM open_orders
        WHERE order_id = ?
        "#,
    )
    .bind(&fill.order_id)
    .fetch_optional(&mut **tx)
    .await
    .context("failed to read open order state for fill application")?
    .ok_or_else(|| anyhow!("order not found for fill_id {}", fill.fill_id))?;

    let new_filled_size = (current_filled + fill.size).min(order_size);
    let new_status = if new_filled_size + FP_TOLERANCE >= order_size {
        "FILLED".to_string()
    } else {
        "PARTIALLY_FILLED".to_string()
    };

    let rows_affected = orders::update_order_status_tx(
        tx,
        &fill.order_id,
        &new_status,
        new_filled_size,
        fill.ingest_ts_ms,
    )
    .await?;

    if rows_affected != 1 {
        return Err(anyhow!(
            "expected exactly one open order row to update for order_id {}, got {}",
            fill.order_id,
            rows_affected
        ));
    }

    let position_updated = update_position_from_fill(tx, fill).await?;

    let ledger_entry_id = append_fill_ledger_entry(tx, fill).await?;

    validate_latest_ledger_invariant(tx).await?;

    advance_fill_cursor_atomically(tx, fill.exchange_ts_ms, Some(fill.fill_id.as_str())).await?;

    Ok(ApplyFillResult {
        already_applied: false,
        order_filled_size: Some(new_filled_size),
        order_status: Some(new_status),
        position_updated,
        ledger_entry_id: Some(ledger_entry_id),
        cursor_advanced: true,
    })
}

pub async fn advance_fill_cursor_atomically(
    tx: &mut Transaction<'_, Sqlite>,
    last_exchange_ts_ms: i64,
    last_fill_id: Option<&str>,
) -> Result<()> {
    let _ = advance_fill_cursor_impl(tx, last_exchange_ts_ms, last_fill_id).await?;
    Ok(())
}

async fn advance_fill_cursor_impl(
    tx: &mut Transaction<'_, Sqlite>,
    last_exchange_ts_ms: i64,
    last_fill_id: Option<&str>,
) -> Result<bool> {
    let (current_ts, current_fill_id): (i64, Option<String>) = sqlx::query_as(
        r#"
        SELECT last_exchange_ts_ms, last_fill_id
        FROM fill_ingest_cursor
        WHERE id = 1
        "#,
    )
    .fetch_optional(&mut **tx)
    .await
    .context("failed to read fill ingestion cursor")?
    .ok_or_else(|| anyhow!("fill_ingest_cursor singleton row (id=1) is missing"))?;

    if last_exchange_ts_ms < current_ts {
        return Err(anyhow!(
            "fill cursor regression detected: current_ts={}, new_ts={}",
            current_ts,
            last_exchange_ts_ms
        ));
    }

    let should_advance = if last_exchange_ts_ms > current_ts {
        true
    } else {
        match (last_fill_id, current_fill_id.as_deref()) {
            (Some(new_id), Some(current_id)) => new_id > current_id,
            (Some(_), None) => true,
            _ => false,
        }
    };

    if !should_advance {
        return Ok(false);
    }

    let updated = sqlx::query(
        r#"
        UPDATE fill_ingest_cursor
        SET last_exchange_ts_ms = ?,
            last_fill_id = ?
        WHERE id = 1
        "#,
    )
    .bind(last_exchange_ts_ms)
    .bind(last_fill_id)
    .execute(&mut **tx)
    .await
    .context("failed to advance fill ingestion cursor")?
    .rows_affected();

    if updated != 1 {
        return Err(anyhow!(
            "expected exactly one cursor row update, got {}",
            updated
        ));
    }

    Ok(true)
}

async fn update_position_from_fill(tx: &mut Transaction<'_, Sqlite>, fill: &Fill) -> Result<bool> {
    let mapping: Option<(String, String)> = sqlx::query_as(
        r#"
        SELECT yes_token_id, no_token_id
        FROM market_tokens
        WHERE market_id = ?
        "#,
    )
    .bind(&fill.market_id)
    .fetch_optional(&mut **tx)
    .await
    .context("failed to load market token mapping for fill")?;

    let Some((yes_token_id, no_token_id)) = mapping else {
        return Ok(false);
    };

    let is_yes = if fill.token_id == yes_token_id {
        Some(true)
    } else if fill.token_id == no_token_id {
        Some(false)
    } else {
        None
    };

    let Some(is_yes_token) = is_yes else {
        return Ok(false);
    };

    let existing_position: Option<(f64, f64, f64, f64, f64, f64, String)> = sqlx::query_as(
        r#"
        SELECT yes_qty, no_qty, avg_price_yes, avg_price_no, realized_pnl, unrealized_pnl, status
        FROM positions
        WHERE market_id = ?
        "#,
    )
    .bind(&fill.market_id)
    .fetch_optional(&mut **tx)
    .await
    .context("failed to load existing position for fill application")?;

    let (mut yes_qty, mut no_qty, mut avg_yes, mut avg_no, mut realized_pnl, unrealized_pnl, status) =
        existing_position.unwrap_or((0.0, 0.0, 0.0, 0.0, 0.0, 0.0, "OPEN".to_string()));

    let fee_usdc = fill.fee_usdc.unwrap_or(0.0);

    if is_yes_token {
        let (new_qty, new_avg, realized_delta) =
            apply_fill_to_outcome_bucket(yes_qty, avg_yes, &fill.side, fill.size, fill.price, fee_usdc)?;
        yes_qty = new_qty;
        avg_yes = new_avg;
        realized_pnl += realized_delta;
    } else {
        let (new_qty, new_avg, realized_delta) =
            apply_fill_to_outcome_bucket(no_qty, avg_no, &fill.side, fill.size, fill.price, fee_usdc)?;
        no_qty = new_qty;
        avg_no = new_avg;
        realized_pnl += realized_delta;
    }

    let updated = Position {
        market_id: fill.market_id.clone(),
        yes_qty,
        no_qty,
        avg_price_yes: avg_yes,
        avg_price_no: avg_no,
        realized_pnl,
        unrealized_pnl,
        status,
        updated_at_ms: fill.ingest_ts_ms,
    };

    positions::upsert_position_tx(tx, &updated).await?;
    Ok(true)
}

fn apply_fill_to_outcome_bucket(
    old_qty: f64,
    old_avg: f64,
    side: &str,
    fill_size: f64,
    fill_price: f64,
    fee_usdc: f64,
) -> Result<(f64, f64, f64)> {
    if fill_size <= 0.0 {
        return Err(anyhow!("fill_size must be positive"));
    }

    match side {
        "BUY" => {
            let new_qty = old_qty + fill_size;
            let new_avg = if new_qty > 0.0 {
                ((old_qty * old_avg) + (fill_size * fill_price)) / new_qty
            } else {
                0.0
            };
            Ok((new_qty, new_avg, -fee_usdc))
        }
        "SELL" => {
            if old_qty + FP_TOLERANCE < fill_size {
                return Err(anyhow!(
                    "sell fill exceeds available outcome inventory: old_qty={}, fill_size={}",
                    old_qty,
                    fill_size
                ));
            }

            let new_qty = (old_qty - fill_size).max(0.0);
            let realized_delta = (fill_size * (fill_price - old_avg)) - fee_usdc;
            let new_avg = if new_qty <= FP_TOLERANCE { 0.0 } else { old_avg };
            Ok((new_qty, new_avg, realized_delta))
        }
        other => Err(anyhow!("unsupported fill side for position update: {other}")),
    }
}

async fn append_fill_ledger_entry(tx: &mut Transaction<'_, Sqlite>, fill: &Fill) -> Result<String> {
    let current = latest_ledger_snapshot(tx).await?;
    let consumed_locked = fill.price * fill.size;

    if consumed_locked < 0.0 {
        return Err(anyhow!("consumed locked amount cannot be negative"));
    }

    if current.locked_balance + FP_TOLERANCE < consumed_locked {
        return Err(anyhow!(
            "insufficient locked balance for fill: locked={}, consumed={}",
            current.locked_balance,
            consumed_locked
        ));
    }

    let new_available = current.available_balance;
    let new_locked = (current.locked_balance - consumed_locked).max(0.0);
    let new_reserved = current.reserved_balance;
    let new_settlement_pending = current.settlement_pending_balance;
    let new_total = current.total_balance - consumed_locked;

    let ledger_entry_id = Uuid::new_v4().to_string();
    let entry = FundsLedgerEntry {
        ledger_entry_id: ledger_entry_id.clone(),
        event_type: "ORDER_FILLED".to_string(),
        order_id: Some(fill.order_id.clone()),
        market_id: Some(fill.market_id.clone()),
        delta_available: 0.0,
        delta_locked: -consumed_locked,
        delta_reserved: 0.0,
        delta_settlement_pending: 0.0,
        total_balance: new_total,
        available_balance: new_available,
        locked_balance: new_locked,
        reserved_balance: new_reserved,
        settlement_pending_balance: new_settlement_pending,
        reason: format!("fill_applied:{}", fill.fill_id),
        ts_ms: fill.ingest_ts_ms,
    };

    ledger::append_ledger_entry_tx(tx, &entry).await?;
    Ok(ledger_entry_id)
}

async fn latest_ledger_snapshot(tx: &mut Transaction<'_, Sqlite>) -> Result<LedgerSnapshot> {
    let snapshot: Option<(f64, f64, f64, f64, f64)> = sqlx::query_as(
        r#"
        SELECT
            total_balance,
            available_balance,
            locked_balance,
            reserved_balance,
            settlement_pending_balance
        FROM funds_ledger
        ORDER BY ts_ms DESC, rowid DESC
        LIMIT 1
        "#,
    )
    .fetch_optional(&mut **tx)
    .await
    .context("failed to read latest funds ledger snapshot")?;

    let (total_balance, available_balance, locked_balance, reserved_balance, settlement_pending_balance) =
        snapshot.ok_or_else(|| anyhow!("funds_ledger is empty; bootstrap ledger state is required"))?;

    Ok(LedgerSnapshot {
        total_balance,
        available_balance,
        locked_balance,
        reserved_balance,
        settlement_pending_balance,
    })
}

async fn validate_latest_ledger_invariant(tx: &mut Transaction<'_, Sqlite>) -> Result<()> {
    let latest = latest_ledger_snapshot(tx).await?;
    let partition_sum = latest.available_balance
        + latest.locked_balance
        + latest.reserved_balance
        + latest.settlement_pending_balance;

    if (partition_sum - latest.total_balance).abs() > FP_TOLERANCE {
        return Err(anyhow!(
            "funds_ledger invariant violated: available({}) + locked({}) + reserved({}) + settlement_pending({}) != total({})",
            latest.available_balance,
            latest.locked_balance,
            latest.reserved_balance,
            latest.settlement_pending_balance,
            latest.total_balance
        ));
    }

    Ok(())
}
