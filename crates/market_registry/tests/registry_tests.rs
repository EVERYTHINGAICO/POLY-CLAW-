use std::sync::Arc;

use market_registry::lifecycle::compute_lifecycle_state;
use market_registry::{
    LifecycleState, MarketRegistry, MarketRegistryConfig, PolymarketClient,
};
use serde_json::json;
use sqlx::SqlitePool;
use storage::db::connect;
use storage::migrate::run_migrations;
use uuid::Uuid;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn temp_db_url() -> String {
    let db_path =
        std::env::temp_dir().join(format!("market_registry_hardening_test_{}.db", Uuid::new_v4()));
    format!("sqlite://{}?mode=rwc", db_path.to_string_lossy().replace('\\', "/"))
}

struct TestHarness {
    registry: MarketRegistry,
    pool: SqlitePool,
    _server: MockServer,
}

async fn setup_harness(db_url: &str, markets_payload: serde_json::Value) -> TestHarness {
    let server = MockServer::start().await;
    mount_market_pages(&server, markets_payload).await;

    let db = connect(db_url)
        .await
        .expect("storage db should initialize");
    run_migrations(&db.pool)
        .await
        .expect("storage migrations should succeed");

    let client = PolymarketClient::new(server.uri()).expect("polymarket client should initialize");
    let registry = MarketRegistry::new(
        db.pool.clone(),
        client,
        MarketRegistryConfig {
            refresh_interval_ms: 30_000,
            closing_buffer_seconds: 60,
        },
    );

    TestHarness {
        registry,
        pool: db.pool,
        _server: server,
    }
}

async fn mount_market_pages(server: &MockServer, page0: serde_json::Value) {
    Mock::given(method("GET"))
        .and(path("/markets"))
        .and(query_param("limit", "500"))
        .and(query_param("offset", "0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(page0))
        .mount(server)
        .await;

    Mock::given(method("GET"))
        .and(path("/markets"))
        .and(query_param("limit", "500"))
        .and(query_param("offset", "500"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(server)
        .await;
}

async fn mount_market_pages_with_expect(
    server: &MockServer,
    page0: serde_json::Value,
    expected_sync_calls: u64,
) {
    Mock::given(method("GET"))
        .and(path("/markets"))
        .and(query_param("limit", "500"))
        .and(query_param("offset", "0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(page0))
        .expect(expected_sync_calls)
        .mount(server)
        .await;

    Mock::given(method("GET"))
        .and(path("/markets"))
        .and(query_param("limit", "500"))
        .and(query_param("offset", "500"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(server)
        .await;
}

fn sample_gamma_markets_payload() -> serde_json::Value {
    json!([
      {
        "id": "mkt-1",
        "question": "Will BTC be above 100k?",
        "category": "crypto",
        "active": true,
        "closed": false,
        "resolved": false,
        "archived": false,
        "endDate": "2099-01-01T00:00:00Z",
        "volume": "1234.50",
        "liquidity": "456.10",
        "clobTokenIds": "[\"yes-token-1\",\"no-token-1\"]",
        "outcomes": "[\"Yes\",\"No\"]",
        "tick_size": "0.01",
        "min_order_size": "1",
        "fee_bps": "10"
      },
      {
        "id": "mkt-2",
        "question": "Closed market",
        "category": "crypto",
        "active": true,
        "closed": true,
        "resolved": false,
        "archived": false,
        "endDate": "2020-01-01T00:00:00Z",
        "volume": "100",
        "liquidity": "50",
        "clobTokenIds": "[\"yes-token-2\",\"no-token-2\"]",
        "outcomes": "[\"Yes\",\"No\"]",
        "tick_size": "0.01",
        "min_order_size": "1",
        "fee_bps": "5"
      },
      {
        "id": "mkt-3",
        "question": "Missing token mapping",
        "category": "crypto",
        "active": true,
        "closed": false,
        "resolved": false,
        "archived": false,
        "endDate": "2099-01-01T00:00:00Z",
        "volume": "20",
        "liquidity": "10",
        "tick_size": "0.01",
        "min_order_size": "1"
      }
    ])
}

fn trading_market_payload() -> serde_json::Value {
    json!([
      {
        "id": "mkt-exp",
        "question": "Expiring market",
        "category": "crypto",
        "active": true,
        "closed": false,
        "resolved": false,
        "archived": false,
        "endDate": "2099-01-01T00:00:00Z",
        "clobTokenIds": "[\"yes-exp\",\"no-exp\"]",
        "outcomes": "[\"Yes\",\"No\"]",
        "tick_size": "0.01",
        "min_order_size": "1"
      }
    ])
}

fn closed_market_payload_without_tokens() -> serde_json::Value {
    json!([
      {
        "id": "mkt-exp",
        "question": "Expiring market",
        "category": "crypto",
        "active": true,
        "closed": true,
        "resolved": false,
        "archived": false,
        "endDate": "2020-01-01T00:00:00Z"
      }
    ])
}

#[tokio::test]
async fn correct_normalization_and_cache_behavior() {
    let db_url = temp_db_url();
    let harness = setup_harness(&db_url, sample_gamma_markets_payload()).await;

    let synced_count = harness
        .registry
        .sync_all_markets()
        .await
        .expect("sync should succeed");
    assert_eq!(synced_count, 3);

    let market = harness
        .registry
        .get_market("mkt-1")
        .await
        .expect("get_market should succeed")
        .expect("market should be in cache");
    assert_eq!(market.market.market_id, "mkt-1");
    assert_eq!(market.market.question, "Will BTC be above 100k?");
    assert_eq!(market.market.yes_token_id.as_deref(), Some("yes-token-1"));
    assert_eq!(market.market.no_token_id.as_deref(), Some("no-token-1"));
    assert_eq!(market.market.lifecycle_state, "TRADING");
    assert!(market.token_mapping_valid);

    let by_token = harness
        .registry
        .get_market_by_token("yes-token-1")
        .await
        .expect("get_market_by_token should succeed")
        .expect("token should map back to market");
    assert_eq!(by_token.market.market_id, "mkt-1");
}

#[tokio::test]
async fn correct_tradability_logic_and_token_mapping() {
    let db_url = temp_db_url();
    let harness = setup_harness(&db_url, sample_gamma_markets_payload()).await;
    harness
        .registry
        .sync_all_markets()
        .await
        .expect("sync should succeed");

    assert!(
        harness
            .registry
            .is_market_tradable("mkt-1")
            .await
            .expect("is_market_tradable should succeed")
    );
    assert!(
        !harness
            .registry
            .is_market_tradable("mkt-2")
            .await
            .expect("is_market_tradable should succeed")
    );
    assert!(
        !harness
            .registry
            .is_market_tradable("mkt-3")
            .await
            .expect("is_market_tradable should succeed")
    );

    let tradable = harness
        .registry
        .get_tradable_markets()
        .await
        .expect("get_tradable_markets should succeed");
    assert_eq!(tradable.len(), 1);
    assert_eq!(tradable[0].market.market_id, "mkt-1");

    assert!(
        harness
            .registry
            .get_market_by_token("yes-token-1")
            .await
            .expect("get_market_by_token should succeed")
            .is_some()
    );
    assert!(
        harness
            .registry
            .get_market_by_token("no-token-1")
            .await
            .expect("get_market_by_token should succeed")
            .is_some()
    );
    assert!(
        harness
            .registry
            .get_market_by_token("unknown-token")
            .await
            .expect("get_market_by_token should succeed")
            .is_none()
    );
}

#[tokio::test]
async fn correct_storage_persistence() {
    let db_url = temp_db_url();
    let harness = setup_harness(&db_url, sample_gamma_markets_payload()).await;
    harness
        .registry
        .sync_all_markets()
        .await
        .expect("sync should succeed");

    let markets_count: i64 = sqlx::query_scalar("SELECT COUNT(1) FROM markets")
        .fetch_one(&harness.pool)
        .await
        .expect("markets count query should succeed");
    assert_eq!(markets_count, 3);

    let market_tokens_count: i64 = sqlx::query_scalar("SELECT COUNT(1) FROM market_tokens")
        .fetch_one(&harness.pool)
        .await
        .expect("market_tokens count query should succeed");
    assert_eq!(market_tokens_count, 2);

    let persisted_lifecycle: String =
        sqlx::query_scalar("SELECT lifecycle_state FROM markets WHERE market_id = 'mkt-1'")
            .fetch_one(&harness.pool)
            .await
            .expect("persisted lifecycle query should succeed");
    assert_eq!(persisted_lifecycle, "TRADING");
}

#[tokio::test]
async fn restart_restores_cache_from_storage() {
    let db_url = temp_db_url();

    let harness_a = setup_harness(&db_url, sample_gamma_markets_payload()).await;
    harness_a
        .registry
        .sync_all_markets()
        .await
        .expect("initial sync should succeed");
    drop(harness_a);

    let harness_b = setup_harness(&db_url, json!([])).await;
    harness_b
        .registry
        .bootstrap_from_storage()
        .await
        .expect("bootstrap_from_storage should succeed");

    let market = harness_b
        .registry
        .get_market("mkt-1")
        .await
        .expect("get_market should succeed")
        .expect("market should be restored from storage");
    assert_eq!(market.market.market_id, "mkt-1");
    assert_eq!(market.market.lifecycle_state, "TRADING");
    assert_eq!(market.market.yes_token_id.as_deref(), Some("yes-token-1"));
    assert_eq!(market.market.no_token_id.as_deref(), Some("no-token-1"));

    let by_token = harness_b
        .registry
        .get_market_by_token("yes-token-1")
        .await
        .expect("get_market_by_token should succeed")
        .expect("token mapping should be restored from storage");
    assert_eq!(by_token.market.market_id, "mkt-1");
}

#[tokio::test]
async fn expired_market_transitions_trading_to_closed_and_preserves_mapping() {
    let db_url = temp_db_url();

    let harness_a = setup_harness(&db_url, trading_market_payload()).await;
    harness_a
        .registry
        .sync_all_markets()
        .await
        .expect("initial trading sync should succeed");
    drop(harness_a);

    let harness_b = setup_harness(&db_url, closed_market_payload_without_tokens()).await;
    harness_b
        .registry
        .bootstrap_from_storage()
        .await
        .expect("bootstrap_from_storage should succeed");

    let before = harness_b
        .registry
        .get_market("mkt-exp")
        .await
        .expect("get_market should succeed")
        .expect("market should be present before closed sync");
    assert_eq!(before.market.lifecycle_state, "TRADING");

    harness_b
        .registry
        .sync_all_markets()
        .await
        .expect("closed sync should succeed");

    let after = harness_b
        .registry
        .get_market("mkt-exp")
        .await
        .expect("get_market should succeed")
        .expect("market should be present after closed sync");
    assert_eq!(after.market.lifecycle_state, "CLOSED");
    assert_eq!(after.market.yes_token_id.as_deref(), Some("yes-exp"));
    assert_eq!(after.market.no_token_id.as_deref(), Some("no-exp"));

    let by_token = harness_b
        .registry
        .get_market_by_token("yes-exp")
        .await
        .expect("get_market_by_token should succeed")
        .expect("expired market mapping must remain available");
    assert_eq!(by_token.market.market_id, "mkt-exp");

    let persisted_lifecycle: String =
        sqlx::query_scalar("SELECT lifecycle_state FROM markets WHERE market_id = 'mkt-exp'")
            .fetch_one(&harness_b.pool)
            .await
            .expect("persisted lifecycle query should succeed");
    assert_eq!(persisted_lifecycle, "CLOSED");
}

#[tokio::test]
async fn concurrent_initialize_is_safe() {
    let db_url = temp_db_url();
    let server = MockServer::start().await;
    mount_market_pages_with_expect(&server, sample_gamma_markets_payload(), 1).await;

    let db = connect(&db_url)
        .await
        .expect("storage db should initialize");
    run_migrations(&db.pool)
        .await
        .expect("storage migrations should succeed");

    let client = PolymarketClient::new(server.uri()).expect("polymarket client should initialize");
    let registry = Arc::new(MarketRegistry::new(
        db.pool.clone(),
        client,
        MarketRegistryConfig::default(),
    ));

    let mut tasks = Vec::new();
    for _ in 0..16 {
        let registry = Arc::clone(&registry);
        tasks.push(tokio::spawn(async move { registry.initialize().await }));
    }

    for task in tasks {
        task.await
            .expect("initialize task should complete")
            .expect("initialize should succeed");
    }

    assert!(registry.is_initialized());
    let cache = registry.cache();
    let guard = cache.read().await;
    assert!(!guard.markets.is_empty());

    server.verify().await;
}

#[test]
fn correct_lifecycle_transitions() {
    let now = 1_700_000_000_000_i64;
    let future = now + 10_000_000;
    let past = now - 1;

    let discovered = compute_lifecycle_state(
        None,
        false,
        false,
        false,
        false,
        future,
        now,
        60,
        false,
    );
    assert_eq!(discovered, LifecycleState::DISCOVERED);

    let eligible = compute_lifecycle_state(
        Some(LifecycleState::DISCOVERED),
        true,
        false,
        false,
        false,
        future,
        now,
        60,
        false,
    );
    assert_eq!(eligible, LifecycleState::ELIGIBLE);

    let trading = compute_lifecycle_state(
        Some(LifecycleState::ELIGIBLE),
        true,
        false,
        false,
        false,
        future,
        now,
        60,
        true,
    );
    assert_eq!(trading, LifecycleState::TRADING);

    let closing = compute_lifecycle_state(
        Some(LifecycleState::TRADING),
        true,
        false,
        false,
        false,
        now + 1_000,
        now,
        60,
        true,
    );
    assert_eq!(closing, LifecycleState::CLOSING_SOON);

    let closed = compute_lifecycle_state(
        Some(LifecycleState::CLOSING_SOON),
        true,
        true,
        false,
        false,
        past,
        now,
        60,
        true,
    );
    assert_eq!(closed, LifecycleState::CLOSED);

    let resolved = compute_lifecycle_state(
        Some(LifecycleState::CLOSED),
        false,
        true,
        true,
        false,
        past,
        now,
        60,
        true,
    );
    assert_eq!(resolved, LifecycleState::RESOLVED);

    let settled = compute_lifecycle_state(
        Some(LifecycleState::SETTLED),
        true,
        false,
        false,
        false,
        future,
        now,
        60,
        true,
    );
    assert_eq!(settled, LifecycleState::SETTLED);
}
