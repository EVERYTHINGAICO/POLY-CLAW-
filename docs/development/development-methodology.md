# Development Methodology

POLY-CLAW is developed as research infrastructure rather than as a black-box trading bot. The method emphasizes explicit boundaries, reproducible validation, and a conservative separation between software correctness and trading-performance claims.

## Principles

1. Define authority boundaries before implementation.
2. Keep strategy generation separate from exchange mutation.
3. Route order admissibility through risk validation before execution.
4. Persist state needed for recovery, audit, and reconciliation.
5. Treat fill ingestion and reconciliation as idempotent operations.
6. Prefer deterministic tests over narrative confidence.
7. Publish only claims supported by evidence.

## Development Loop

The project follows this loop:

```text
architecture claim
  -> typed module boundary
  -> minimal implementation
  -> targeted tests
  -> validation report
  -> documentation and release note
  -> next research gate
```

## Evidence Types

| Evidence | Purpose | Current status |
| --- | --- | --- |
| Rust tests | Verify software contracts | Present |
| SQLite migration | Define persistence surface | Present |
| Git history | Preserve development progression | Present |
| Changelog | Explain versioned changes | Present |
| Research docs | Separate claims from evidence | Present |
| Atlas | Visualize architecture and review boundaries | Present |
| CI workflow | Re-run validation on GitHub | Present |

## Claim Discipline

Allowed claims:

- The workspace compiles and tests pass for the covered contracts.
- The architecture separates strategy, risk, execution, storage, and reconciliation concerns.
- The atlas visualizes the current architecture and operational surfaces.

Disallowed claims without further evidence:

- The system is profitable.
- The system is live-trading ready.
- The system is regulatory-complete.
- The system has solved slippage, liquidity, or exchange failure modes.

## Review Standard

A reviewer should be able to inspect:

- what code exists,
- what tests cover,
- what docs claim,
- what remains open,
- how the version was validated,
- and how the system can be run locally.

This standard is intentionally closer to a research artifact than to a marketing repository.
