import Database from "better-sqlite3";
import { Router } from "express";

import type {
  AuthorityState,
  CapitalSummary,
  DlqItem,
  DlqSummary,
  FundsEntry,
  IntentFailure,
  IntentRecord,
  IntentsSummary,
  LiveSummary,
  MarketsSummary,
  OrderRecord,
  OrdersSummary,
  PositionEntry,
  PositionsSummary,
  PreflightCheck,
  PreflightResponse,
  RecentFill,
  SystemEvent,
} from "./liveStateTypes.js";

let cachedDb: Database.Database | null = null;
let cachedDbPath: string | null = null;

function openDatabase(dbPath: string): Database.Database | null {
  if (cachedDb && cachedDbPath === dbPath) {
    try {
      cachedDb.pragma("journal_mode");
      return cachedDb;
    } catch {
      cachedDb = null;
      cachedDbPath = null;
    }
  }

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma("journal_mode = WAL");
    cachedDb = db;
    cachedDbPath = dbPath;
    return db;
  } catch {
    cachedDb = null;
    cachedDbPath = null;
    return null;
  }
}

function unavailable(reason: string): LiveSummary {
  return {
    status: "unavailable",
    timestamp_ms: Date.now(),
    reason,
    authority: { kill_switch_active: true, safe_mode_enabled: false, safe_mode_reason: null },
    intents: { queued: 0, in_flight: 0, submitted: 0, done: 0, failed: 0, dlq: 0, recent_failures: [] },
    orders: { total_open: 0, by_status: {}, recent_fills: [] },
    capital: { total_balance: 0, available_balance: 0, locked_balance: 0, reserved_balance: 0, settlement_pending_balance: 0 },
    positions: { total_open: 0, total_realized_pnl: 0, total_unrealized_pnl: 0, markets: [] },
    markets: { by_lifecycle: {}, total: 0 },
    dlq: { count: 0, items: [] },
  };
}

function queryAuthority(db: Database.Database): AuthorityState {
  const result: AuthorityState = {
    kill_switch_active: true,
    safe_mode_enabled: false,
    safe_mode_reason: null,
  };

  try {
    const rows = db
      .prepare("SELECT config_key, config_value FROM system_configuration WHERE config_key IN ('kill_switch', 'safe_mode_enabled', 'safe_mode_reason')")
      .all() as Array<{ config_key: string; config_value: string }>;

    for (const row of rows) {
      if (row.config_key === "kill_switch") {
        result.kill_switch_active = row.config_value === "1" || row.config_value === "true";
      } else if (row.config_key === "safe_mode_enabled") {
        result.safe_mode_enabled = row.config_value === "1" || row.config_value === "true";
      } else if (row.config_key === "safe_mode_reason") {
        result.safe_mode_reason = row.config_value || null;
      }
    }
  } catch {
    // Table may not exist yet
  }

  return result;
}

function queryIntents(db: Database.Database): IntentsSummary {
  const summary: IntentsSummary = {
    queued: 0, in_flight: 0, submitted: 0, done: 0, failed: 0, dlq: 0,
    recent_failures: [],
  };

  try {
    const counts = db
      .prepare("SELECT state, COUNT(*) as count FROM execution_intents GROUP BY state")
      .all() as Array<{ state: string; count: number }>;

    const stateMap: Record<string, keyof Pick<IntentsSummary, "queued" | "in_flight" | "submitted" | "done" | "failed" | "dlq">> = {
      QUEUED: "queued", IN_FLIGHT: "in_flight", SUBMITTED: "submitted",
      DONE: "done", FAILED: "failed", DLQ: "dlq",
    };

    for (const row of counts) {
      const key = stateMap[row.state];
      if (key) {
        summary[key] = row.count;
      }
    }

    summary.recent_failures = db
      .prepare("SELECT intent_id, market_id, intent_type, last_error, ts_ms FROM execution_intents WHERE state IN ('FAILED','DLQ') ORDER BY ts_ms DESC LIMIT 5")
      .all() as IntentFailure[];
  } catch {
    // Table may not exist
  }

  return summary;
}

function queryOrders(db: Database.Database): OrdersSummary {
  const summary: OrdersSummary = { total_open: 0, by_status: {}, recent_fills: [] };

  try {
    const counts = db
      .prepare("SELECT status, COUNT(*) as count FROM open_orders GROUP BY status")
      .all() as Array<{ status: string; count: number }>;

    let total = 0;
    for (const row of counts) {
      summary.by_status[row.status] = row.count;
      total += row.count;
    }
    summary.total_open = total;
  } catch {
    // Table may not exist
  }

  try {
    summary.recent_fills = db
      .prepare("SELECT fill_id, market_id, side, price, size, fee_usdc, exchange_ts_ms FROM fills ORDER BY exchange_ts_ms DESC LIMIT 10")
      .all() as RecentFill[];
  } catch {
    // Table may not exist
  }

  return summary;
}

function queryCapital(db: Database.Database): CapitalSummary {
  const defaults: CapitalSummary = {
    total_balance: 0, available_balance: 0, locked_balance: 0,
    reserved_balance: 0, settlement_pending_balance: 0,
  };

  try {
    const row = db
      .prepare("SELECT total_balance, available_balance, locked_balance, reserved_balance, settlement_pending_balance FROM funds_ledger ORDER BY ts_ms DESC LIMIT 1")
      .get() as CapitalSummary | undefined;

    return row ?? defaults;
  } catch {
    return defaults;
  }
}

function queryPositions(db: Database.Database): PositionsSummary {
  const summary: PositionsSummary = {
    total_open: 0, total_realized_pnl: 0, total_unrealized_pnl: 0, markets: [],
  };

  try {
    const rows = db
      .prepare("SELECT market_id, yes_qty, no_qty, realized_pnl, unrealized_pnl, status FROM positions WHERE status = 'OPEN'")
      .all() as PositionEntry[];

    summary.markets = rows;
    summary.total_open = rows.length;
    for (const r of rows) {
      summary.total_realized_pnl += r.realized_pnl;
      summary.total_unrealized_pnl += r.unrealized_pnl;
    }
  } catch {
    // Table may not exist
  }

  return summary;
}

function queryMarkets(db: Database.Database): MarketsSummary {
  const summary: MarketsSummary = { by_lifecycle: {}, total: 0 };

  try {
    const rows = db
      .prepare("SELECT lifecycle_state, COUNT(*) as count FROM markets GROUP BY lifecycle_state")
      .all() as Array<{ lifecycle_state: string; count: number }>;

    let total = 0;
    for (const row of rows) {
      summary.by_lifecycle[row.lifecycle_state] = row.count;
      total += row.count;
    }
    summary.total = total;
  } catch {
    // Table may not exist
  }

  return summary;
}

function queryDlq(db: Database.Database): DlqSummary {
  try {
    const items = db
      .prepare("SELECT dlq_id, intent_id, market_id, reason, attempts, first_seen_ts_ms, last_attempt_ts_ms FROM execution_dead_letters ORDER BY last_attempt_ts_ms DESC")
      .all() as DlqItem[];

    return { count: items.length, items };
  } catch {
    return { count: 0, items: [] };
  }
}

function queryEvents(db: Database.Database, sinceMs: number, limit: number): SystemEvent[] {
  const events: SystemEvent[] = [];

  try {
    const intents = db
      .prepare("SELECT intent_id, ts_ms, state FROM execution_intents WHERE ts_ms >= ? ORDER BY ts_ms DESC LIMIT ?")
      .all(sinceMs, limit) as Array<{ intent_id: string; ts_ms: number; state: string }>;

    for (const row of intents) {
      const severity = ["FAILED", "DLQ"].includes(row.state) ? "error" as const
        : row.state === "DONE" ? "success" as const : "info" as const;
      events.push({
        id: row.intent_id,
        ts_ms: row.ts_ms,
        event_type: "intent",
        detail: `Intent ${row.intent_id.slice(0, 8)}… → ${row.state}`,
        severity,
      });
    }
  } catch { /* table may not exist */ }

  try {
    const fills = db
      .prepare("SELECT fill_id, exchange_ts_ms, side, size, price FROM fills WHERE exchange_ts_ms >= ? ORDER BY exchange_ts_ms DESC LIMIT ?")
      .all(sinceMs, limit) as Array<{ fill_id: string; exchange_ts_ms: number; side: string; size: number; price: number }>;

    for (const row of fills) {
      events.push({
        id: row.fill_id,
        ts_ms: row.exchange_ts_ms,
        event_type: "fill",
        detail: `${row.side.toUpperCase()} ${row.size} @ $${row.price.toFixed(4)}`,
        severity: "success",
      });
    }
  } catch { /* table may not exist */ }

  try {
    const dlqItems = db
      .prepare("SELECT intent_id, last_attempt_ts_ms, reason FROM execution_dead_letters WHERE last_attempt_ts_ms >= ? ORDER BY last_attempt_ts_ms DESC LIMIT ?")
      .all(sinceMs, limit) as Array<{ intent_id: string; last_attempt_ts_ms: number; reason: string }>;

    for (const row of dlqItems) {
      events.push({
        id: row.intent_id,
        ts_ms: row.last_attempt_ts_ms,
        event_type: "dlq",
        detail: `DLQ: ${row.reason.slice(0, 80)}`,
        severity: "error",
      });
    }
  } catch { /* table may not exist */ }

  events.sort((a, b) => b.ts_ms - a.ts_ms);
  return events.slice(0, limit);
}

function buildSummary(db: Database.Database): LiveSummary {
  return {
    status: "ok",
    timestamp_ms: Date.now(),
    authority: queryAuthority(db),
    intents: queryIntents(db),
    orders: queryOrders(db),
    capital: queryCapital(db),
    positions: queryPositions(db),
    markets: queryMarkets(db),
    dlq: queryDlq(db),
  };
}

function buildPreflight(db: Database.Database | null, jaegerUrl: string): PreflightResponse {
  const checks: PreflightCheck[] = [];

  // 1. Database accessible
  checks.push(
    db
      ? { name: "Database", status: "GO", detail: "SQLite database is accessible (read-only)" }
      : { name: "Database", status: "NO_GO", detail: "SQLite database not found or inaccessible" },
  );

  if (!db) {
    checks.push(
      { name: "Kill Switch", status: "NO_GO", detail: "Cannot determine — database unavailable" },
      { name: "Safe Mode", status: "NO_GO", detail: "Cannot determine — database unavailable" },
      { name: "Dead Letter Queue", status: "NO_GO", detail: "Cannot determine — database unavailable" },
      { name: "Failed Intents", status: "NO_GO", detail: "Cannot determine — database unavailable" },
      { name: "Capital Available", status: "NO_GO", detail: "Cannot determine — database unavailable" },
      { name: "Markets Trading", status: "NO_GO", detail: "Cannot determine — database unavailable" },
    );
  } else {
    const authority = queryAuthority(db);

    // 2. Kill switch
    checks.push(
      authority.kill_switch_active
        ? { name: "Kill Switch", status: "NO_GO", detail: "Kill switch is ACTIVE — live execution disabled" }
        : { name: "Kill Switch", status: "GO", detail: "Kill switch disengaged — live execution permitted" },
    );

    // 3. Safe mode
    checks.push(
      authority.safe_mode_enabled
        ? { name: "Safe Mode", status: "WARN", detail: `Safe mode ON: ${authority.safe_mode_reason ?? "no reason given"}` }
        : { name: "Safe Mode", status: "GO", detail: "Safe mode disabled" },
    );

    // 4. DLQ
    const dlq = queryDlq(db);
    checks.push(
      dlq.count > 0
        ? { name: "Dead Letter Queue", status: "WARN", detail: `${dlq.count} item(s) in DLQ requiring attention` }
        : { name: "Dead Letter Queue", status: "GO", detail: "DLQ is empty" },
    );

    // 5. Failed intents (last 5 min)
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    let recentFailed = 0;
    try {
      const row = db
        .prepare("SELECT COUNT(*) as count FROM execution_intents WHERE state IN ('FAILED','DLQ') AND ts_ms >= ?")
        .get(fiveMinAgo) as { count: number } | undefined;
      recentFailed = row?.count ?? 0;
    } catch { /* table may not exist */ }

    checks.push(
      recentFailed > 0
        ? { name: "Failed Intents", status: "WARN", detail: `${recentFailed} failed intent(s) in last 5 minutes` }
        : { name: "Failed Intents", status: "GO", detail: "No failed intents in last 5 minutes" },
    );

    // 6. Capital
    const capital = queryCapital(db);
    checks.push(
      capital.available_balance > 0
        ? { name: "Capital Available", status: "GO", detail: `$${capital.available_balance.toFixed(2)} available of $${capital.total_balance.toFixed(2)} total` }
        : { name: "Capital Available", status: "WARN", detail: "No available capital" },
    );

    // 7. Markets trading
    const markets = queryMarkets(db);
    const tradingCount = markets.by_lifecycle["TRADING"] ?? 0;
    checks.push(
      tradingCount > 0
        ? { name: "Markets Trading", status: "GO", detail: `${tradingCount} market(s) in TRADING state` }
        : { name: "Markets Trading", status: "WARN", detail: "No markets currently in TRADING state" },
    );
  }

  // 8. Jaeger (async check done separately — here we just record the URL)
  checks.push({ name: "Jaeger Telemetry", status: "GO", detail: `Configured at ${jaegerUrl}` });

  const noGoCount = checks.filter((c) => c.status === "NO_GO").length;
  const ready = noGoCount === 0;

  return { status: "ok", ready, checks };
}

export function createLiveStateRouter(dbPath: string, jaegerUrl: string): Router {
  const router = Router();

  router.get("/summary", (_req, res) => {
    const db = openDatabase(dbPath);
    if (!db) {
      res.json(unavailable("Database not found at: " + dbPath));
      return;
    }
    res.json(buildSummary(db));
  });

  router.get("/intents", (req, res) => {
    const db = openDatabase(dbPath);
    if (!db) {
      res.json({ status: "unavailable", intents: [] });
      return;
    }

    const sinceMs = Number.parseInt((req.query.since_ms as string) ?? "0", 10);
    const limit = Math.min(Number.parseInt((req.query.limit as string) ?? "100", 10), 500);

    try {
      const intents = db
        .prepare("SELECT intent_id, ts_ms, market_id, intent_type, state, last_error FROM execution_intents WHERE ts_ms >= ? ORDER BY ts_ms DESC LIMIT ?")
        .all(sinceMs, limit) as IntentRecord[];
      res.json({ status: "ok", intents });
    } catch {
      res.json({ status: "ok", intents: [] });
    }
  });

  router.get("/orders", (req, res) => {
    const db = openDatabase(dbPath);
    if (!db) {
      res.json({ status: "unavailable", orders: [] });
      return;
    }

    const marketId = req.query.market_id as string | undefined;
    const status = req.query.status as string | undefined;

    try {
      let sql = "SELECT order_id, market_id, side, price, size, filled_size, status, created_at_ms, updated_at_ms FROM open_orders";
      const params: unknown[] = [];
      const clauses: string[] = [];

      if (marketId) {
        clauses.push("market_id = ?");
        params.push(marketId);
      }
      if (status) {
        clauses.push("status = ?");
        params.push(status);
      }
      if (clauses.length > 0) {
        sql += " WHERE " + clauses.join(" AND ");
      }
      sql += " ORDER BY updated_at_ms DESC LIMIT 200";

      const orders = db.prepare(sql).all(...params) as OrderRecord[];
      res.json({ status: "ok", orders });
    } catch {
      res.json({ status: "ok", orders: [] });
    }
  });

  router.get("/funds-history", (req, res) => {
    const db = openDatabase(dbPath);
    if (!db) {
      res.json({ status: "unavailable", entries: [] });
      return;
    }

    const limit = Math.min(Number.parseInt((req.query.limit as string) ?? "50", 10), 200);

    try {
      const entries = db
        .prepare("SELECT event_type, delta_available, delta_locked, total_balance, available_balance, locked_balance, ts_ms, reason FROM funds_ledger ORDER BY ts_ms DESC LIMIT ?")
        .all(limit) as FundsEntry[];
      res.json({ status: "ok", entries });
    } catch {
      res.json({ status: "ok", entries: [] });
    }
  });

  router.get("/events", (req, res) => {
    const db = openDatabase(dbPath);
    if (!db) {
      res.json({ status: "unavailable", events: [] });
      return;
    }

    const sinceMs = Number.parseInt((req.query.since_ms as string) ?? String(Date.now() - 5 * 60 * 1000), 10);
    const limit = Math.min(Number.parseInt((req.query.limit as string) ?? "50", 10), 200);

    res.json({ status: "ok", events: queryEvents(db, sinceMs, limit) });
  });

  router.get("/preflight", (_req, res) => {
    const db = openDatabase(dbPath);
    res.json(buildPreflight(db, jaegerUrl));
  });

  // F12: Jaeger Latency Heatmap
  router.get("/traces/latency", async (_req, res) => {
    try {
      const resp = await fetch(`${jaegerUrl}/api/traces?service=polymarket-execution-system&limit=20&lookback=1h`);
      if (!resp.ok) {
        res.json({ edges: [] });
        return;
      }

      const payload = await resp.json() as { data?: Array<{ spans?: Array<{ operationName: string; duration: number; references?: Array<{ spanID: string }> }> }> };
      const spanDurations = new Map<string, number[]>();

      for (const trace of payload.data ?? []) {
        for (const span of trace.spans ?? []) {
          const key = span.operationName;
          if (!spanDurations.has(key)) spanDurations.set(key, []);
          spanDurations.get(key)!.push(span.duration / 1000); // Convert microseconds to ms
        }
      }

      // Map operation names to pipeline edges
      const stageMapping: Record<string, [string, string]> = {
        "market_data.fetch": ["market_data", "strategy"],
        "strategy.evaluate": ["strategy", "risk_engine"],
        "risk.check": ["risk_engine", "intent_queue"],
        "intent.queue": ["intent_queue", "execution_engine"],
        "execution.submit": ["execution_engine", "polymarket_adapter"],
      };

      const edges: Array<{ source: string; target: string; avg_duration_ms: number; p99_duration_ms: number }> = [];

      for (const [opName, durations] of spanDurations) {
        const mapping = stageMapping[opName];
        if (!mapping || durations.length === 0) continue;
        const sorted = [...durations].sort((a, b) => a - b);
        const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
        const p99Index = Math.min(Math.floor(sorted.length * 0.99), sorted.length - 1);
        edges.push({
          source: mapping[0],
          target: mapping[1],
          avg_duration_ms: Math.round(avg * 100) / 100,
          p99_duration_ms: sorted[p99Index] ?? avg,
        });
      }

      res.json({ edges });
    } catch {
      res.json({ edges: [] });
    }
  });

  // F15: Time Travel — historical snapshot
  router.get("/snapshot", (req, res) => {
    const db = openDatabase(dbPath);
    if (!db) {
      res.json(unavailable("Database not found at: " + dbPath));
      return;
    }

    const atMs = Number.parseInt((req.query.at_ms as string) ?? String(Date.now()), 10);

    try {
      // Reconstruct intents summary at timestamp
      const intentsSummary: IntentsSummary = { queued: 0, in_flight: 0, submitted: 0, done: 0, failed: 0, dlq: 0, recent_failures: [] };
      try {
        const counts = db
          .prepare("SELECT state, COUNT(*) as count FROM execution_intents WHERE ts_ms <= ? GROUP BY state")
          .all(atMs) as Array<{ state: string; count: number }>;
        const stateMap: Record<string, keyof Pick<IntentsSummary, "queued" | "in_flight" | "submitted" | "done" | "failed" | "dlq">> = {
          QUEUED: "queued", IN_FLIGHT: "in_flight", SUBMITTED: "submitted",
          DONE: "done", FAILED: "failed", DLQ: "dlq",
        };
        for (const row of counts) {
          const key = stateMap[row.state];
          if (key) intentsSummary[key] = row.count;
        }
      } catch { /* table may not exist */ }

      // Capital at timestamp
      let capital: CapitalSummary = { total_balance: 0, available_balance: 0, locked_balance: 0, reserved_balance: 0, settlement_pending_balance: 0 };
      try {
        const row = db
          .prepare("SELECT total_balance, available_balance, locked_balance, reserved_balance, settlement_pending_balance FROM funds_ledger WHERE ts_ms <= ? ORDER BY ts_ms DESC LIMIT 1")
          .get(atMs) as CapitalSummary | undefined;
        if (row) capital = row;
      } catch { /* table may not exist */ }

      // DLQ at timestamp
      let dlqItems: DlqItem[] = [];
      try {
        dlqItems = db
          .prepare("SELECT dlq_id, intent_id, market_id, reason, attempts, first_seen_ts_ms, last_attempt_ts_ms FROM execution_dead_letters WHERE first_seen_ts_ms <= ?")
          .all(atMs) as DlqItem[];
      } catch { /* table may not exist */ }

      const snapshot: LiveSummary = {
        status: "ok",
        timestamp_ms: atMs,
        authority: queryAuthority(db),
        intents: intentsSummary,
        orders: queryOrders(db),
        capital,
        positions: queryPositions(db),
        markets: queryMarkets(db),
        dlq: { count: dlqItems.length, items: dlqItems },
      };

      res.json(snapshot);
    } catch {
      res.json(unavailable("Failed to reconstruct snapshot"));
    }
  });

  // F15: Time Travel — data time range
  router.get("/time-range", (_req, res) => {
    const db = openDatabase(dbPath);
    if (!db) {
      res.json({ earliest_ms: Date.now() - 3600000, latest_ms: Date.now() });
      return;
    }

    let earliest = Date.now();
    let latest = Date.now();

    try {
      const intentRange = db
        .prepare("SELECT MIN(ts_ms) as min_ts, MAX(ts_ms) as max_ts FROM execution_intents")
        .get() as { min_ts: number | null; max_ts: number | null } | undefined;
      if (intentRange?.min_ts) earliest = Math.min(earliest, intentRange.min_ts);
      if (intentRange?.max_ts) latest = Math.max(latest, intentRange.max_ts);
    } catch { /* table may not exist */ }

    try {
      const fundsRange = db
        .prepare("SELECT MIN(ts_ms) as min_ts, MAX(ts_ms) as max_ts FROM funds_ledger")
        .get() as { min_ts: number | null; max_ts: number | null } | undefined;
      if (fundsRange?.min_ts) earliest = Math.min(earliest, fundsRange.min_ts);
      if (fundsRange?.max_ts) latest = Math.max(latest, fundsRange.max_ts);
    } catch { /* table may not exist */ }

    res.json({ earliest_ms: earliest, latest_ms: latest });
  });

  return router;
}
