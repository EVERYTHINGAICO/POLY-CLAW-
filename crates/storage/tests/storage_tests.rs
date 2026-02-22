use std::path::PathBuf;

use sqlx::SqlitePool;
use storage::{
    atomic::{advance_fill_cursor_atomically, apply_fill_atomically},
    db::connect,
    migrate::run_migrations,
    models::{Fill, Market, MarketToken, OpenOrder},
    repos::{fills, markets, orders},
    tx::begin_immediate,
};
use uuid::Uuid;

const EPSILON: f64 = 1e-9;

fn temp_db_path() -> PathBuf {
    let base = PathBuf::from("target").join("test-dbs");
    std::fs::create_dir_all(&base).expect("test db directory should be created");
    base.join(format!("polymarket_storage_test_{}.db", Uuid::new_v4()))
}

fn sqlite_url(path: &PathBuf) -> String {
    format!(
        "sqlite://{}?mode=rwc",
        path.to_string_lossy().replace('\\', "/")
    )
}

async fn setup_migrated_pool() -> SqlitePool {
    let db_path = temp_db_path();
    let database_url = sqlite_url(&db_path);
    let db = connect(&database_url)
        .await
        .expect("database connection should initialize");
    run_migrations(&db.pool)
        .await
        .expect("migrations should run successfully");
    db.pool
}

async fn seed_market(pool: &SqlitePool, market_id: &str) {
    let market = Market {
        market_id: market_id.to_string(),
        question: "BTC above threshold?".to_string(),
        category: Some("crypto".to_string()),
        tags_json: Some("[\"btc\",\"15m\"]".to_string()),
        end_time_ts_ms: 1_700_000_000_000,
        status: "active".to_string(),
        active: true,
        closed: false,
        resolved: false,
        volume: Some(1000.0),
        liquidity: Some(500.0),
        yes_token_id: Some("yes-token".to_string()),
        no_token_id: Some("no-token".to_string()),
        tick_size: Some(0.01),
        min_order_size: Some(1.0),
        fee_model: Some("maker_taker".to_string()),
        lifecycle_state: "TRADING".to_string(),
        last_refreshed_ts_ms: 1_700_000_000_500,
    };

    markets::upsert_market(pool, &market)
        .await
        .expect("market insert should succeed");
}

async fn seed_market_token(pool: &SqlitePool, market_id: &str) {
    let token = MarketToken {
        market_id: market_id.to_string(),
        yes_token_id: "yes-token".to_string(),
        no_token_id: "no-token".to_string(),
        tick_size: 0.01,
        min_order_size: 1.0,
        price_min: 0.0,
        price_max: 1.0,
        fee_bps: 0,
        source: "test".to_string(),
        last_refreshed_ts_ms: 1_700_000_000_600,
        valid: true,
    };

    markets::upsert_market_token(pool, &token)
        .await
        .expect("market token insert should succeed");
}

async fn seed_order(pool: &SqlitePool, market_id: &str, order_id: &str, exchange_order_id: &str) {
    seed_order_with_shape(
        pool,
        market_id,
        order_id,
        exchange_order_id,
        0.51,
        10.0,
        0.0,
        "OPEN",
    )
    .await;
}

async fn seed_order_with_shape(
    pool: &SqlitePool,
    market_id: &str,
    order_id: &str,
    exchange_order_id: &str,
    price: f64,
    size: f64,
    filled_size: f64,
    status: &str,
) {
    let order = OpenOrder {
        order_id: order_id.to_string(),
        client_order_id: format!("client-{order_id}"),
        exchange_order_id: Some(exchange_order_id.to_string()),
        strategy_id: Some("strategy-1".to_string()),
        market_id: market_id.to_string(),
        token_id: Some("yes-token".to_string()),
        side: "BUY".to_string(),
        price,
        size,
        filled_size,
        status: status.to_string(),
        created_at_ms: 1_700_000_001_000,
        updated_at_ms: 1_700_000_001_000,
    };

    orders::upsert_open_order(pool, &order)
        .await
        .expect("order insert should succeed");
}

async fn seed_ledger_snapshot(
    pool: &SqlitePool,
    order_id: &str,
    market_id: &str,
    total_balance: f64,
    available_balance: f64,
    locked_balance: f64,
    reserved_balance: f64,
    settlement_pending_balance: f64,
    ts_ms: i64,
) {
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
    .bind(Uuid::new_v4().to_string())
    .bind("BALANCE_SYNC")
    .bind(order_id)
    .bind(market_id)
    .bind(0.0_f64)
    .bind(0.0_f64)
    .bind(0.0_f64)
    .bind(0.0_f64)
    .bind(total_balance)
    .bind(available_balance)
    .bind(locked_balance)
    .bind(reserved_balance)
    .bind(settlement_pending_balance)
    .bind("test_seed")
    .bind(ts_ms)
    .execute(pool)
    .await
    .expect("ledger seed insert should succeed");
}

fn sample_fill(
    fill_id: &str,
    exchange_fill_id: &str,
    order_id: &str,
    exchange_order_id: &str,
    market_id: &str,
    exchange_ts_ms: i64,
    ingest_ts_ms: i64,
) -> Fill {
    Fill {
        fill_id: fill_id.to_string(),
        exchange_fill_id: exchange_fill_id.to_string(),
        order_id: order_id.to_string(),
        exchange_order_id: Some(exchange_order_id.to_string()),
        market_id: market_id.to_string(),
        token_id: "yes-token".to_string(),
        side: "BUY".to_string(),
        price: 0.50,
        size: 100.0,
        fee_usdc: Some(0.0),
        liquidity: Some("maker".to_string()),
        exchange_ts_ms,
        ingest_ts_ms,
        raw_json: Some("{\"source\":\"test\"}".to_string()),
    }
}

fn approx_eq(left: f64, right: f64) -> bool {
    (left - right).abs() <= EPSILON
}

#[tokio::test]
async fn database_connection_works() {
    let db_path = temp_db_path();
    let database_url = sqlite_url(&db_path);
    let db = connect(&database_url)
        .await
        .expect("database connection should initialize");

    let one: i64 = sqlx::query_scalar("SELECT 1")
        .fetch_one(&db.pool)
        .await
        .expect("simple query should work");

    assert_eq!(one, 1);
}

#[tokio::test]
async fn wal_mode_enabled() {
    let db_path = temp_db_path();
    let database_url = sqlite_url(&db_path);
    let db = connect(&database_url)
        .await
        .expect("database connection should initialize");

    let mode: String = sqlx::query_scalar("PRAGMA journal_mode;")
        .fetch_one(&db.pool)
        .await
        .expect("journal mode query should succeed");

    assert_eq!(mode.to_lowercase(), "wal");
}

#[tokio::test]
async fn migration_runs_successfully() {
    let pool = setup_migrated_pool().await;

    let fills_exists: i64 =
        sqlx::query_scalar("SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name='fills';")
            .fetch_one(&pool)
            .await
            .expect("table lookup should succeed");

    assert_eq!(fills_exists, 1);
}

#[tokio::test]
async fn fill_ingest_cursor_singleton_enforced() {
    let pool = setup_migrated_pool().await;

    let row_count: i64 = sqlx::query_scalar("SELECT COUNT(1) FROM fill_ingest_cursor;")
        .fetch_one(&pool)
        .await
        .expect("cursor row count should be readable");

    assert_eq!(row_count, 1);

    let second_insert = sqlx::query(
        r#"
        INSERT INTO fill_ingest_cursor (id, cursor_key, last_exchange_ts_ms, last_fill_id)
        VALUES (2, 'fills', 0, NULL);
        "#,
    )
    .execute(&pool)
    .await;

    assert!(second_insert.is_err());
}

#[tokio::test]
async fn insert_fill_if_not_exists_prevents_duplicates() {
    let pool = setup_migrated_pool().await;
    seed_market(&pool, "market-btc-15m").await;
    seed_order(&pool, "market-btc-15m", "order-1", "exchange-order-1").await;

    let fill = Fill {
        fill_id: "fill-1".to_string(),
        exchange_fill_id: "exchange-fill-1".to_string(),
        order_id: "order-1".to_string(),
        exchange_order_id: Some("exchange-order-1".to_string()),
        market_id: "market-btc-15m".to_string(),
        token_id: "yes-token".to_string(),
        side: "BUY".to_string(),
        price: 0.52,
        size: 5.0,
        fee_usdc: Some(0.01),
        liquidity: Some("maker".to_string()),
        exchange_ts_ms: 1_700_000_002_000,
        ingest_ts_ms: 1_700_000_002_050,
        raw_json: Some("{\"source\":\"test\"}".to_string()),
    };

    let inserted = fills::insert_fill_if_not_exists(&pool, &fill)
        .await
        .expect("first fill insert should succeed");
    assert!(inserted);

    let inserted_again = fills::insert_fill_if_not_exists(&pool, &fill)
        .await
        .expect("duplicate fill insert should not error");
    assert!(!inserted_again);

    let count: i64 = sqlx::query_scalar("SELECT COUNT(1) FROM fills WHERE exchange_fill_id = ?;")
        .bind("exchange-fill-1")
        .fetch_one(&pool)
        .await
        .expect("fill count lookup should succeed");

    assert_eq!(count, 1);
}

#[tokio::test]
async fn unique_constraints_enforced() {
    let pool = setup_migrated_pool().await;
    seed_market(&pool, "market-btc-5m").await;

    seed_order(&pool, "market-btc-5m", "order-a", "exchange-order-duplicate").await;

    let duplicate_exchange_order = OpenOrder {
        order_id: "order-b".to_string(),
        client_order_id: "client-order-b".to_string(),
        exchange_order_id: Some("exchange-order-duplicate".to_string()),
        strategy_id: Some("strategy-1".to_string()),
        market_id: "market-btc-5m".to_string(),
        token_id: Some("yes-token".to_string()),
        side: "BUY".to_string(),
        price: 0.49,
        size: 9.0,
        filled_size: 0.0,
        status: "OPEN".to_string(),
        created_at_ms: 1_700_000_003_000,
        updated_at_ms: 1_700_000_003_000,
    };

    let duplicate_order_result = orders::upsert_open_order(&pool, &duplicate_exchange_order).await;
    assert!(duplicate_order_result.is_err());

    let first_fill_insert = sqlx::query(
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
        "#,
    )
    .bind("fill-a")
    .bind("exchange-fill-dup")
    .bind("order-a")
    .bind("exchange-order-duplicate")
    .bind("market-btc-5m")
    .bind("yes-token")
    .bind("BUY")
    .bind(0.55)
    .bind(2.0)
    .bind(Option::<f64>::None)
    .bind("maker")
    .bind(1_700_000_003_100_i64)
    .bind(1_700_000_003_150_i64)
    .bind(Option::<String>::None)
    .execute(&pool)
    .await
    .expect("first fill insert should succeed");

    assert_eq!(first_fill_insert.rows_affected(), 1);

    let duplicate_fill_insert = sqlx::query(
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
        "#,
    )
    .bind("fill-b")
    .bind("exchange-fill-dup")
    .bind("order-a")
    .bind("exchange-order-duplicate")
    .bind("market-btc-5m")
    .bind("yes-token")
    .bind("BUY")
    .bind(0.56)
    .bind(2.0)
    .bind(Option::<f64>::None)
    .bind("maker")
    .bind(1_700_000_003_200_i64)
    .bind(1_700_000_003_250_i64)
    .bind(Option::<String>::None)
    .execute(&pool)
    .await;

    assert!(duplicate_fill_insert.is_err());
}

#[tokio::test]
async fn atomic_fill_commit() {
    let pool = setup_migrated_pool().await;
    let market_id = "market-atomic-commit";
    let order_id = "order-atomic-commit";
    let exchange_order_id = "exchange-order-atomic-commit";

    seed_market(&pool, market_id).await;
    seed_market_token(&pool, market_id).await;
    seed_order_with_shape(
        &pool,
        market_id,
        order_id,
        exchange_order_id,
        0.50,
        200.0,
        0.0,
        "OPEN",
    )
    .await;
    seed_ledger_snapshot(
        &pool,
        order_id,
        market_id,
        1000.0,
        900.0,
        100.0,
        0.0,
        0.0,
        1_700_000_009_000,
    )
    .await;

    let fill = sample_fill(
        "fill-atomic-commit-1",
        "exchange-fill-atomic-commit-1",
        order_id,
        exchange_order_id,
        market_id,
        1_700_000_010_000,
        1_700_000_010_050,
    );

    let mut tx = begin_immediate(&pool)
        .await
        .expect("BEGIN IMMEDIATE transaction should start");
    let result = apply_fill_atomically(&mut tx.tx, &fill)
        .await
        .expect("apply_fill_atomically should commit successfully");
    tx.commit().await.expect("transaction commit should succeed");

    assert!(!result.already_applied);
    assert!(result.position_updated);
    assert!(result.ledger_entry_id.is_some());
    assert!(result.cursor_advanced);
    assert_eq!(result.order_status.as_deref(), Some("PARTIALLY_FILLED"));
    assert!(approx_eq(result.order_filled_size.unwrap_or_default(), 100.0));

    let (filled_size, status): (f64, String) = sqlx::query_as(
        "SELECT filled_size, status FROM open_orders WHERE order_id = ?",
    )
    .bind(order_id)
    .fetch_one(&pool)
    .await
    .expect("order should exist after atomic fill");
    assert!(approx_eq(filled_size, 100.0));
    assert_eq!(status, "PARTIALLY_FILLED");

    let (yes_qty, avg_price_yes): (f64, f64) =
        sqlx::query_as("SELECT yes_qty, avg_price_yes FROM positions WHERE market_id = ?")
            .bind(market_id)
            .fetch_one(&pool)
            .await
            .expect("position should be upserted for mapped token");
    assert!(approx_eq(yes_qty, 100.0));
    assert!(approx_eq(avg_price_yes, 0.50));

    let (total, available, locked, reserved, settlement_pending): (f64, f64, f64, f64, f64) =
        sqlx::query_as(
            r#"
            SELECT total_balance, available_balance, locked_balance, reserved_balance, settlement_pending_balance
            FROM funds_ledger
            ORDER BY ts_ms DESC, rowid DESC
            LIMIT 1
            "#,
        )
        .fetch_one(&pool)
        .await
        .expect("latest ledger snapshot should exist");

    assert!(approx_eq(total, 950.0));
    assert!(approx_eq(available, 900.0));
    assert!(approx_eq(locked, 50.0));
    assert!(approx_eq(reserved, 0.0));
    assert!(approx_eq(settlement_pending, 0.0));

    let (cursor_ts, cursor_fill_id): (i64, Option<String>) =
        sqlx::query_as("SELECT last_exchange_ts_ms, last_fill_id FROM fill_ingest_cursor WHERE id = 1")
            .fetch_one(&pool)
            .await
            .expect("cursor row should exist");
    assert_eq!(cursor_ts, 1_700_000_010_000);
    assert_eq!(cursor_fill_id.as_deref(), Some("fill-atomic-commit-1"));

    let mut duplicate_tx = begin_immediate(&pool)
        .await
        .expect("BEGIN IMMEDIATE transaction should start for idempotency check");
    let duplicate_result = apply_fill_atomically(&mut duplicate_tx.tx, &fill)
        .await
        .expect("duplicate fill apply should be idempotent");
    duplicate_tx
        .commit()
        .await
        .expect("duplicate transaction commit should succeed");

    assert!(duplicate_result.already_applied);

    let fill_count: i64 = sqlx::query_scalar("SELECT COUNT(1) FROM fills WHERE fill_id = ?")
        .bind("fill-atomic-commit-1")
        .fetch_one(&pool)
        .await
        .expect("fill count should be readable");
    assert_eq!(fill_count, 1);

    let ledger_rows: i64 = sqlx::query_scalar("SELECT COUNT(1) FROM funds_ledger")
        .fetch_one(&pool)
        .await
        .expect("ledger row count should be readable");
    assert_eq!(ledger_rows, 2);
}

#[tokio::test]
async fn atomic_fill_rollback() {
    let pool = setup_migrated_pool().await;
    let market_id = "market-atomic-rollback";
    let order_id = "order-atomic-rollback";
    let exchange_order_id = "exchange-order-atomic-rollback";

    seed_market(&pool, market_id).await;
    seed_market_token(&pool, market_id).await;
    seed_order_with_shape(
        &pool,
        market_id,
        order_id,
        exchange_order_id,
        0.50,
        200.0,
        0.0,
        "OPEN",
    )
    .await;

    // Deliberately broken baseline invariant: 900 + 100 + 0 + 10 != 1000.
    seed_ledger_snapshot(
        &pool,
        order_id,
        market_id,
        1000.0,
        900.0,
        100.0,
        0.0,
        10.0,
        1_700_000_020_000,
    )
    .await;

    let fill = sample_fill(
        "fill-atomic-rollback-1",
        "exchange-fill-atomic-rollback-1",
        order_id,
        exchange_order_id,
        market_id,
        1_700_000_021_000,
        1_700_000_021_050,
    );

    let mut tx = begin_immediate(&pool)
        .await
        .expect("BEGIN IMMEDIATE transaction should start");
    let apply_result = apply_fill_atomically(&mut tx.tx, &fill).await;
    assert!(apply_result.is_err());
    tx.rollback()
        .await
        .expect("transaction rollback should succeed");

    let fill_count: i64 = sqlx::query_scalar("SELECT COUNT(1) FROM fills WHERE fill_id = ?")
        .bind("fill-atomic-rollback-1")
        .fetch_one(&pool)
        .await
        .expect("fill count should be readable");
    assert_eq!(fill_count, 0);

    let order_filled_size: f64 =
        sqlx::query_scalar("SELECT filled_size FROM open_orders WHERE order_id = ?")
            .bind(order_id)
            .fetch_one(&pool)
            .await
            .expect("order state should be readable");
    assert!(approx_eq(order_filled_size, 0.0));

    let ledger_rows: i64 = sqlx::query_scalar("SELECT COUNT(1) FROM funds_ledger")
        .fetch_one(&pool)
        .await
        .expect("ledger row count should be readable");
    assert_eq!(ledger_rows, 1);

    let (cursor_ts, cursor_fill_id): (i64, Option<String>) =
        sqlx::query_as("SELECT last_exchange_ts_ms, last_fill_id FROM fill_ingest_cursor WHERE id = 1")
            .fetch_one(&pool)
            .await
            .expect("cursor row should exist");
    assert_eq!(cursor_ts, 0);
    assert!(cursor_fill_id.is_none());
}

#[tokio::test]
async fn cursor_monotonic() {
    let pool = setup_migrated_pool().await;

    let mut tx1 = begin_immediate(&pool)
        .await
        .expect("BEGIN IMMEDIATE should succeed");
    advance_fill_cursor_atomically(&mut tx1.tx, 100, Some("fill-100"))
        .await
        .expect("cursor advance should succeed");
    tx1.commit().await.expect("commit should succeed");

    let mut tx2 = begin_immediate(&pool)
        .await
        .expect("BEGIN IMMEDIATE should succeed");
    let backwards = advance_fill_cursor_atomically(&mut tx2.tx, 90, Some("fill-090")).await;
    assert!(backwards.is_err());
    tx2.rollback().await.expect("rollback should succeed");

    let mut tx3 = begin_immediate(&pool)
        .await
        .expect("BEGIN IMMEDIATE should succeed");
    advance_fill_cursor_atomically(&mut tx3.tx, 100, Some("fill-099"))
        .await
        .expect("same timestamp older fill id should no-op without error");
    tx3.commit().await.expect("commit should succeed");

    let (cursor_ts, cursor_fill_id): (i64, Option<String>) =
        sqlx::query_as("SELECT last_exchange_ts_ms, last_fill_id FROM fill_ingest_cursor WHERE id = 1")
            .fetch_one(&pool)
            .await
            .expect("cursor row should exist");
    assert_eq!(cursor_ts, 100);
    assert_eq!(cursor_fill_id.as_deref(), Some("fill-100"));
}

#[tokio::test]
async fn ledger_invariant_preserved() {
    let pool = setup_migrated_pool().await;
    let market_id = "market-ledger-invariant";
    let order_id = "order-ledger-invariant";
    let exchange_order_id = "exchange-order-ledger-invariant";

    seed_market(&pool, market_id).await;
    seed_market_token(&pool, market_id).await;
    seed_order_with_shape(
        &pool,
        market_id,
        order_id,
        exchange_order_id,
        0.50,
        200.0,
        0.0,
        "OPEN",
    )
    .await;
    seed_ledger_snapshot(
        &pool,
        order_id,
        market_id,
        1000.0,
        900.0,
        100.0,
        0.0,
        0.0,
        1_700_000_030_000,
    )
    .await;

    let fill = sample_fill(
        "fill-ledger-invariant-1",
        "exchange-fill-ledger-invariant-1",
        order_id,
        exchange_order_id,
        market_id,
        1_700_000_031_000,
        1_700_000_031_050,
    );

    let mut tx = begin_immediate(&pool)
        .await
        .expect("BEGIN IMMEDIATE transaction should start");
    apply_fill_atomically(&mut tx.tx, &fill)
        .await
        .expect("fill application should succeed");
    tx.commit().await.expect("commit should succeed");

    let (total, available, locked, reserved, settlement_pending): (f64, f64, f64, f64, f64) =
        sqlx::query_as(
            r#"
            SELECT total_balance, available_balance, locked_balance, reserved_balance, settlement_pending_balance
            FROM funds_ledger
            ORDER BY ts_ms DESC, rowid DESC
            LIMIT 1
            "#,
        )
        .fetch_one(&pool)
        .await
        .expect("latest ledger snapshot should exist");

    let partition_sum = available + locked + reserved + settlement_pending;
    assert!(approx_eq(partition_sum, total));
}
