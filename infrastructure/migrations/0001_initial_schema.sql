PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS system_configuration (
    config_key TEXT PRIMARY KEY,
    config_value TEXT NOT NULL,
    config_version INTEGER NOT NULL,
    last_updated_ts_ms INTEGER NOT NULL,
    updated_by TEXT
);

CREATE TABLE IF NOT EXISTS markets (
    market_id TEXT PRIMARY KEY,
    question TEXT NOT NULL,
    category TEXT,
    tags_json TEXT,
    end_time_ts_ms INTEGER NOT NULL,
    status TEXT NOT NULL,
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    closed INTEGER NOT NULL CHECK (closed IN (0, 1)),
    resolved INTEGER NOT NULL CHECK (resolved IN (0, 1)),
    volume REAL,
    liquidity REAL,
    yes_token_id TEXT,
    no_token_id TEXT,
    tick_size REAL,
    min_order_size REAL,
    fee_model TEXT,
    lifecycle_state TEXT NOT NULL CHECK (
        lifecycle_state IN (
            'DISCOVERED',
            'ELIGIBLE',
            'TRADING',
            'CLOSING_SOON',
            'CLOSED',
            'RESOLVED',
            'SETTLED',
            'DELISTED'
        )
    ),
    last_refreshed_ts_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS market_tokens (
    market_id TEXT PRIMARY KEY,
    yes_token_id TEXT NOT NULL,
    no_token_id TEXT NOT NULL,
    tick_size REAL NOT NULL,
    min_order_size REAL NOT NULL,
    price_min REAL NOT NULL,
    price_max REAL NOT NULL,
    fee_bps INTEGER NOT NULL,
    source TEXT NOT NULL,
    last_refreshed_ts_ms INTEGER NOT NULL,
    valid INTEGER NOT NULL CHECK (valid IN (0, 1)),
    FOREIGN KEY (market_id) REFERENCES markets (market_id)
);

CREATE TABLE IF NOT EXISTS market_lifecycle_state (
    market_id TEXT PRIMARY KEY,
    lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('OPEN', 'CLOSED', 'RESOLVED')),
    last_update_ts_ms INTEGER NOT NULL,
    exchange_source_ts_ms INTEGER,
    FOREIGN KEY (market_id) REFERENCES markets (market_id)
);

CREATE TABLE IF NOT EXISTS open_orders (
    order_id TEXT PRIMARY KEY,
    client_order_id TEXT NOT NULL UNIQUE,
    exchange_order_id TEXT UNIQUE,
    strategy_id TEXT,
    market_id TEXT NOT NULL,
    token_id TEXT,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL', 'YES', 'NO')),
    price REAL NOT NULL,
    size REAL NOT NULL CHECK (size > 0),
    filled_size REAL NOT NULL DEFAULT 0 CHECK (filled_size >= 0),
    status TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    FOREIGN KEY (market_id) REFERENCES markets (market_id)
);

CREATE TABLE IF NOT EXISTS fills (
    fill_id TEXT PRIMARY KEY,
    exchange_fill_id TEXT NOT NULL UNIQUE,
    order_id TEXT NOT NULL,
    exchange_order_id TEXT,
    market_id TEXT NOT NULL,
    token_id TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    price REAL NOT NULL,
    size REAL NOT NULL CHECK (size > 0),
    fee_usdc REAL,
    liquidity TEXT CHECK (liquidity IN ('maker', 'taker') OR liquidity IS NULL),
    exchange_ts_ms INTEGER NOT NULL,
    ingest_ts_ms INTEGER NOT NULL,
    raw_json TEXT,
    FOREIGN KEY (order_id) REFERENCES open_orders (order_id),
    FOREIGN KEY (exchange_order_id) REFERENCES open_orders (exchange_order_id),
    FOREIGN KEY (market_id) REFERENCES markets (market_id)
);

CREATE TABLE IF NOT EXISTS fill_ingest_cursor (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    cursor_key TEXT NOT NULL UNIQUE CHECK (cursor_key = 'fills'),
    last_exchange_ts_ms INTEGER NOT NULL DEFAULT 0,
    last_fill_id TEXT
);

CREATE TABLE IF NOT EXISTS execution_intents (
    intent_id TEXT PRIMARY KEY,
    ts_ms INTEGER NOT NULL,
    market_id TEXT NOT NULL,
    intent_type TEXT NOT NULL CHECK (
        intent_type IN ('PLACE_LIMIT', 'PLACE_MARKET', 'CANCEL', 'REPLACE', 'EMERGENCY_FLATTEN')
    ),
    payload_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('QUEUED', 'IN_FLIGHT', 'DONE', 'FAILED', 'DLQ')),
    idempotency_key TEXT NOT NULL UNIQUE,
    last_error TEXT,
    FOREIGN KEY (market_id) REFERENCES markets (market_id)
);

CREATE TABLE IF NOT EXISTS execution_dead_letters (
    dlq_id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL,
    market_id TEXT NOT NULL,
    intent_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    first_seen_ts_ms INTEGER NOT NULL,
    last_attempt_ts_ms INTEGER NOT NULL,
    attempts INTEGER NOT NULL CHECK (attempts >= 0),
    operator_notes TEXT,
    FOREIGN KEY (intent_id) REFERENCES execution_intents (intent_id),
    FOREIGN KEY (market_id) REFERENCES markets (market_id)
);

CREATE TABLE IF NOT EXISTS funds_ledger (
    ledger_entry_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    order_id TEXT,
    market_id TEXT,
    delta_available REAL NOT NULL,
    delta_locked REAL NOT NULL,
    delta_reserved REAL NOT NULL,
    delta_settlement_pending REAL NOT NULL,
    total_balance REAL NOT NULL,
    available_balance REAL NOT NULL,
    locked_balance REAL NOT NULL,
    reserved_balance REAL NOT NULL,
    settlement_pending_balance REAL NOT NULL,
    reason TEXT NOT NULL,
    ts_ms INTEGER NOT NULL,
    CHECK (available_balance >= 0),
    CHECK (locked_balance >= 0),
    CHECK (reserved_balance >= 0),
    CHECK (settlement_pending_balance >= 0),
    FOREIGN KEY (order_id) REFERENCES open_orders (order_id),
    FOREIGN KEY (market_id) REFERENCES markets (market_id)
);

CREATE TABLE IF NOT EXISTS positions (
    market_id TEXT PRIMARY KEY,
    yes_qty REAL NOT NULL DEFAULT 0,
    no_qty REAL NOT NULL DEFAULT 0,
    avg_price_yes REAL NOT NULL DEFAULT 0,
    avg_price_no REAL NOT NULL DEFAULT 0,
    realized_pnl REAL NOT NULL DEFAULT 0,
    unrealized_pnl REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SETTLED')),
    updated_at_ms INTEGER NOT NULL,
    FOREIGN KEY (market_id) REFERENCES markets (market_id)
);

CREATE INDEX IF NOT EXISTS idx_open_orders_market_status
    ON open_orders (market_id, status);

CREATE INDEX IF NOT EXISTS idx_fills_order_id
    ON fills (order_id);

CREATE INDEX IF NOT EXISTS idx_fills_market_exchange_ts
    ON fills (market_id, exchange_ts_ms);

CREATE INDEX IF NOT EXISTS idx_fills_token_exchange_ts
    ON fills (token_id, exchange_ts_ms);

CREATE INDEX IF NOT EXISTS idx_execution_intents_state_ts
    ON execution_intents (state, ts_ms);

CREATE INDEX IF NOT EXISTS idx_execution_dead_letters_market_ts
    ON execution_dead_letters (market_id, first_seen_ts_ms);

CREATE INDEX IF NOT EXISTS idx_funds_ledger_market_ts
    ON funds_ledger (market_id, ts_ms);

INSERT OR IGNORE INTO fill_ingest_cursor (
    id,
    cursor_key,
    last_exchange_ts_ms,
    last_fill_id
) VALUES (
    1,
    'fills',
    0,
    NULL
);
