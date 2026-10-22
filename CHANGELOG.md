# Changelog

## 2026-10-22 — Portfolio and atlas validation

- Aligned the React plugin with Vite 8 and updated the frontend lockfile.
- Used Node.js 22 for atlas validation.
- Removed a leftover sandbox write-test file.
- Added an architecture overview to the README.

All notable changes to POLY-CLAW are documented here.

This project separates software engineering evidence from trading-performance claims. A release version means the repository state is documented and reproducible; it does not imply live trading readiness or profitability.

## 0.1.0-private-research - 2026-09-26

### Added

- Rust multi-crate workspace for Polymarket execution-system research.
- Core crates for configuration, market registry, risk validation, execution engine, fill listener, intent queue, reconciliation, storage, strategy boundary, and operations CLI.
- SQLite migration and storage layer with WAL, cursor, ledger, order, fill, market, and position surfaces.
- Market registry tests covering lifecycle transitions, tradability, token mapping, persistence, restart recovery, and concurrency-safe initialization.
- Reconciliation tests covering single-fill success, duplicate-fill idempotency, and commit-gated cursor advancement.
- Risk engine tests covering allowed orders and rejection paths for capital, market exposure, global exposure, outcome limits, and expiration windows.
- Storage tests covering migrations, unique constraints, cursor monotonicity, atomic commit, atomic rollback, duplicate fill prevention, and ledger invariant preservation.
- Research publication materials: README, disclaimer, security policy, citation metadata, validation report, and research program.
- GitHub Actions validation workflow for Rust tests and architecture-atlas validation.
- Execution Architecture Atlas under `tools/execution-architecture-atlas/` for visual review of crate topology, execution pipeline, operational panels, and exportable architecture evidence.

### Validation

- `cargo test --workspace`: 26 tests passed, 0 failed.
- Atlas backend: `npm audit`: 0 vulnerabilities.
- Atlas frontend: `npm audit`: 0 vulnerabilities.
- Atlas backend: `npm run typecheck`: passed.
- Atlas frontend: `npm run build`: passed.

### Known Limits

- This is research software, not a production live-trading release.
- The repository does not claim a proven trading edge.
- Exchange adapter hardening, live secrets handling, incident runbooks, and forward-testing protocols remain future gates.
- Atlas frontend currently builds with expected large-bundle warnings due to 3D visualization dependencies.
