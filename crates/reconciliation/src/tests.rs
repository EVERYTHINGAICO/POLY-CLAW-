use std::sync::Arc;

use fill_listener::types::{FillEvent, FillSide};
use storage::db::{connect, Database};
use storage::migrate::run_migrations;
use storage::models::{FundsLedgerEntry, Market, MarketToken, OpenOrder};
use storage::repos::{ledger, markets, orders};
use uuid::Uuid;

use crate::engine::ReconciliationEngine;

fn unique_db_url(test_name: &str) -> String {
    let base = std::path::PathBuf::from("target").join("test-dbs");
    std::fs::create_dir_all(&base).expect("test db directory should be created");
    let unique = Uuid::new_v4().to_string();
    let path = base.join(format!("polybot_{test_name}_{unique}.db"));
    format!(
        "sqlite://{}?mode=rwc",
        path.to_string_lossy().replace('\\', "/")
    )
}

async fn seeded_db() -> Arc<Database> {
    let db = connect(&unique_db_url("reconciliation"))
        .await
        .expect("db connect");
    run_migrations(&db.pool).await.expect("migrate");

    let market_id = "mkt_1".to_string();

    let market = Market {
        market_id: market_id.clone(),
        question: "Test market".to_string(),
        category: None,
        tags_json: None,
        end_time_ts_ms: 9_999_999,
        status: "active".to_string(),
        active: true,
        closed: false,
        resolved: false,
        volume: None,
        liquidity: None,
        yes_token_id: Some("tok_yes".to_string()),
        no_token_id: Some("tok_no".to_string()),
        tick_size: Some(0.01),
        min_order_size: Some(1.0),
        fee_model: None,
        lifecycle_state: "TRADING".to_string(),
        last_refreshed_ts_ms: 1,
    };
    markets::upsert_market(&db.pool, &market)
        .await
        .expect("upsert market");

    let token = MarketToken {
        market_id: market_id.clone(),
        yes_token_id: "tok_yes".to_string(),
        no_token_id: "tok_no".to_string(),
        tick_size: 0.01,
        min_order_size: 1.0,
        price_min: 0.0,
        price_max: 1.0,
        fee_bps: 0,
        source: "test".to_string(),
        last_refreshed_ts_ms: 1,
        valid: true,
    };
    markets::upsert_market_token(&db.pool, &token)
        .await
        .expect("upsert token");

    let order = OpenOrder {
        order_id: "ord_1".to_string(),
        client_order_id: "cli_1".to_string(),
        exchange_order_id: Some("ex_ord_1".to_string()),
        strategy_id: None,
        market_id: market_id.clone(),
        token_id: Some("tok_yes".to_string()),
        side: "BUY".to_string(),
        price: 0.4,
        size: 10.0,
        filled_size: 0.0,
        status: "OPEN".to_string(),
        created_at_ms: 1_000,
        updated_at_ms: 1_000,
    };
    orders::upsert_open_order(&db.pool, &order)
        .await
        .expect("upsert open order");

    let ledger_entry = FundsLedgerEntry {
        ledger_entry_id: Uuid::new_v4().to_string(),
        event_type: "BOOTSTRAP".to_string(),
        order_id: None,
        market_id: None,
        delta_available: 0.0,
        delta_locked: 0.0,
        delta_reserved: 0.0,
        delta_settlement_pending: 0.0,
        total_balance: 1000.0,
        available_balance: 900.0,
        locked_balance: 100.0,
        reserved_balance: 0.0,
        settlement_pending_balance: 0.0,
        reason: "bootstrap".to_string(),
        ts_ms: 1,
    };
    ledger::append_ledger_entry(&db.pool, &ledger_entry)
        .await
        .expect("append bootstrap ledger entry");

    Arc::new(db)
}

fn sample_fill(fill_id: &str, exchange_ts_ms: u64) -> FillEvent {
    FillEvent {
        fill_id: fill_id.to_string(),
        order_id: "ord_1".to_string(),
        market_id: "mkt_1".to_string(),
        token_id: "tok_yes".to_string(),
        side: FillSide::Buy,
        price: 0.4,
        size: 10.0,
        fee_usdc: Some(0.0),
        exchange_ts_ms,
        ingest_ts_ms: exchange_ts_ms + 1,
        raw_json: None,
    }
}

#[tokio::test(flavor = "current_thread")]
async fn test_reconcile_single_fill_success_path() {
    let db = seeded_db().await;
    let engine = ReconciliationEngine::new(db);

    let outcome = engine
        .reconcile_fill(&sample_fill("fill_1", 2_000))
        .await
        .expect("reconcile should succeed");

    assert_eq!(outcome.fills_processed, 1);
    assert_eq!(outcome.fills_inserted, 1);
    assert_eq!(outcome.duplicates_ignored, 0);
    assert_eq!(outcome.cursor_advanced_count, 1);
}

#[tokio::test(flavor = "current_thread")]
async fn test_idempotent_duplicate_fill_id() {
    let db = seeded_db().await;
    let engine = ReconciliationEngine::new(db);
    let fill = sample_fill("fill_dup", 2_100);

    let first = engine.reconcile_fill(&fill).await.expect("first reconcile");
    let second = engine
        .reconcile_fill(&fill)
        .await
        .expect("second reconcile");

    assert_eq!(first.fills_inserted, 1);
    assert_eq!(first.duplicates_ignored, 0);
    assert_eq!(second.fills_inserted, 0);
    assert_eq!(second.duplicates_ignored, 1);
}

#[tokio::test(flavor = "current_thread")]
async fn test_cursor_advances_after_commit() {
    let db = seeded_db().await;
    let engine = ReconciliationEngine::new(db);

    let outcome = engine
        .reconcile_batch(&[sample_fill("fill_a", 3_000), sample_fill("fill_b", 3_001)])
        .await
        .expect("batch reconcile should succeed");

    assert_eq!(outcome.fills_processed, 2);
    assert_eq!(outcome.fills_inserted, 2);
    assert_eq!(outcome.duplicates_ignored, 0);
    assert_eq!(outcome.cursor_advanced_count, 2);
}
