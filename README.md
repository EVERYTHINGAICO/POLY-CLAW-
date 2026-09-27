# POLY-CLAW

POLY-CLAW is an experimental Rust research system for Polymarket execution architecture, risk gating, market lifecycle tracking, persistence, and reconciliation.

The project is not presented as a profitable trading strategy. Its contribution is the engineering model: a typed, testable execution core for prediction-market trading research where strategy generation, risk validation, exchange execution, fill reconciliation, and durable state are treated as separate concerns.

> Important: this repository is research software. It is not financial advice, not a recommendation to trade, and not evidence of a proven edge.

## Research Contribution

POLY-CLAW explores how to build a prediction-market execution system with explicit control boundaries:

- The execution engine is the only component intended to submit or cancel exchange orders.
- The risk engine gates orders before execution using capital, market, outcome, and expiration constraints.
- The market registry normalizes Polymarket market metadata, token mappings, tradability, lifecycle state, and cache recovery.
- The storage layer provides SQLite persistence, migrations, WAL mode, idempotent fill ingestion, ledger invariants, and atomic rollback behavior.
- Reconciliation processes fill events idempotently and advances cursors only after successful commits.
- Strategy crates remain isolated from direct exchange write authority.

This separation is deliberate. Software correctness, operational safety, and trading edge are different claims and require different evidence.

## Current Evidence State

The current local validation run completed successfully:

```text
cargo test --workspace
26 tests passed
0 failed
```

Covered areas:

- `market_registry`: lifecycle transitions, tradability, token mapping, persistence, cache restoration, concurrency safety.
- `reconciliation`: fill reconciliation, cursor advancement, duplicate fill idempotency.
- `risk_engine`: valid-order allowance and rejection paths for insufficient capital, market exposure, global exposure, outcome limits, and expiration window violations.
- `storage`: database connection, WAL mode, migrations, uniqueness, cursor monotonicity, atomic commit, atomic rollback, and ledger invariant preservation.

See [docs/validation/rust-test-report.md](docs/validation/rust-test-report.md).

## Workspace Map

```text
crates/
  common/             shared placeholder crate
  config/             deterministic configuration provider and typed config
  execution_engine/   execution boundary, coordinator, tracing, fill processing
  execution_tool/     external tool boundary placeholder
  fill_listener/      fill event traits, types, and engine boundary
  intent_queue/       intent queue types and errors
  market_registry/    Polymarket market metadata, lifecycle, token mapping, sync
  ops_cli/            operations CLI entrypoint
  reconciliation/     fill reconciliation engine and idempotency behavior
  risk_engine/        capital, exposure, outcome, and expiration risk gate
  storage/            SQLite models, migrations, repositories, transactions
  strategy/           strategy trait and engine boundary

infrastructure/
  migrations/         SQLite schema

tools/
  execution-architecture-atlas/
                       React/Vite + Node/TypeScript atlas for visualizing the
                       POLY-CLAW crate graph, execution pipeline, live-state
                       surfaces, and architecture evidence
```

## Architecture

```text
Market metadata / fills
        |
        v
Market registry + fill listener
        |
        v
Strategy boundary -> Intent queue -> Risk engine
                                      |
                                      v
                              Execution engine
                                      |
                                      v
                              Exchange adapter
                                      |
                                      v
                         Storage + reconciliation
```

The intended production invariant is simple: strategy code proposes intent, risk code decides admissibility, and execution code owns mutation against the exchange.

## Architecture Atlas

The repository includes an architecture visualization tool at [tools/execution-architecture-atlas](tools/execution-architecture-atlas/README.md). It is intentionally separate from the Rust workspace: it does not modify `Cargo.toml`, does not add Rust dependencies, and can be installed or run independently.

The atlas provides:

- A 3D graph of crates, modules, dependencies, and execution surfaces.
- A visual pipeline from market data through strategy, risk, intent, execution, and reconciliation.
- Inspector panels for architecture review, operational state, preflight checks, positions, capital, alerts, event timelines, session playback, and state machines.
- Backend tools for graph generation, API serving, diagram export, and optional Jaeger trace overlay.

Validated local commands:

```bash
cd tools/execution-architecture-atlas/backend
npm run typecheck

cd ../frontend
npm run build
```

## Quick Start

Install Rust with Cargo, then run:

```bash
cargo test --workspace
```

To inspect the workspace:

```bash
cargo metadata --format-version 1
```

To run the atlas locally:

```bash
cd tools/execution-architecture-atlas/backend
npm ci
npm run generate -- --workspace ../..
npm run serve
```

In another terminal:

```bash
cd tools/execution-architecture-atlas/frontend
npm ci
npm run dev
```

Open `http://localhost:5173`.

The repository currently contains an architecture-oriented execution core. It is not a turnkey live-trading application and should not be connected to live funds without further review, exchange-adapter hardening, secrets handling, rate-limit policy, incident runbooks, and forward-testing evidence.

## Research Program

The publication framing is in [docs/research/research-program.md](docs/research/research-program.md). It defines the scope, falsifiable claims, threat model, and evidence gates needed before any stronger operational or trading claim can be made.

## Versioned Development Evidence

- [VERSION](VERSION) identifies the current private research baseline.
- [CHANGELOG.md](CHANGELOG.md) summarizes versioned development work.
- [Development methodology](docs/development/development-methodology.md) documents the engineering and research method.
- [Release notes](docs/releases/v0.1.0-private-research.md) define what this private review version does and does not claim.

## Safety And Responsibility

- Do not commit private keys, wallet material, API secrets, `.env` files, local databases, or runtime logs.
- Do not interpret passing tests as proof of profitability.
- Do not enable live trading from this repository without a separate operational review.
- Read [DISCLAIMER.md](DISCLAIMER.md) and [SECURITY.md](SECURITY.md).

## License

This repository is prepared for Apache-2.0 licensing. See [LICENSE](LICENSE).
