use anyhow::{Context, Result};
use sqlx::SqliteExecutor;

use crate::models::{Market, MarketToken};

pub async fn upsert_market<'e, E>(executor: E, market: &Market) -> Result<()>
where
    E: SqliteExecutor<'e>,
{
    sqlx::query(
        r#"
        INSERT INTO markets (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(market_id) DO UPDATE SET
            question = excluded.question,
            category = excluded.category,
            tags_json = excluded.tags_json,
            end_time_ts_ms = excluded.end_time_ts_ms,
            status = excluded.status,
            active = excluded.active,
            closed = excluded.closed,
            resolved = excluded.resolved,
            volume = excluded.volume,
            liquidity = excluded.liquidity,
            yes_token_id = excluded.yes_token_id,
            no_token_id = excluded.no_token_id,
            tick_size = excluded.tick_size,
            min_order_size = excluded.min_order_size,
            fee_model = excluded.fee_model,
            lifecycle_state = excluded.lifecycle_state,
            last_refreshed_ts_ms = excluded.last_refreshed_ts_ms
        "#,
    )
    .bind(&market.market_id)
    .bind(&market.question)
    .bind(&market.category)
    .bind(&market.tags_json)
    .bind(market.end_time_ts_ms)
    .bind(&market.status)
    .bind(market.active)
    .bind(market.closed)
    .bind(market.resolved)
    .bind(market.volume)
    .bind(market.liquidity)
    .bind(&market.yes_token_id)
    .bind(&market.no_token_id)
    .bind(market.tick_size)
    .bind(market.min_order_size)
    .bind(&market.fee_model)
    .bind(&market.lifecycle_state)
    .bind(market.last_refreshed_ts_ms)
    .execute(executor)
    .await
    .context("failed to upsert market")?;

    Ok(())
}

pub async fn upsert_market_token<'e, E>(executor: E, token: &MarketToken) -> Result<()>
where
    E: SqliteExecutor<'e>,
{
    sqlx::query(
        r#"
        INSERT INTO market_tokens (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(market_id) DO UPDATE SET
            yes_token_id = excluded.yes_token_id,
            no_token_id = excluded.no_token_id,
            tick_size = excluded.tick_size,
            min_order_size = excluded.min_order_size,
            price_min = excluded.price_min,
            price_max = excluded.price_max,
            fee_bps = excluded.fee_bps,
            source = excluded.source,
            last_refreshed_ts_ms = excluded.last_refreshed_ts_ms,
            valid = excluded.valid
        "#,
    )
    .bind(&token.market_id)
    .bind(&token.yes_token_id)
    .bind(&token.no_token_id)
    .bind(token.tick_size)
    .bind(token.min_order_size)
    .bind(token.price_min)
    .bind(token.price_max)
    .bind(token.fee_bps)
    .bind(&token.source)
    .bind(token.last_refreshed_ts_ms)
    .bind(token.valid)
    .execute(executor)
    .await
    .context("failed to upsert market token")?;

    Ok(())
}
