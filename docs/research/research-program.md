# Research Program

POLY-CLAW studies the engineering question of how to structure a Polymarket execution system so that research strategies, risk limits, execution authority, state recovery, and audit evidence remain separable.

## Primary Claim

The repository currently supports a bounded software-engineering claim:

> A Rust workspace can encode core Polymarket execution-system boundaries with testable modules for market registry, risk gating, persistence, and reconciliation.

It does not claim:

- Proven profitability
- Statistical trading edge
- Live deployment readiness
- Regulatory suitability
- Complete exchange-adapter hardening

## Research Questions

1. Can prediction-market execution be represented as separable typed components?
2. Can risk validation be isolated before exchange mutation?
3. Can fill reconciliation be made idempotent and recoverable?
4. Can market lifecycle and token mapping be persisted and restored deterministically?
5. Can the system preserve auditability without giving strategy code exchange write authority?

## Evidence Classes

| Evidence class | Current status |
| --- | --- |
| Unit and integration tests | Present for registry, reconciliation, risk, and storage |
| Persistence schema | Present via SQLite migration |
| Architecture documentation | Present in README and source module boundaries |
| CI enforcement | Added as repository workflow |
| Live exchange proof | Not claimed |
| Strategy edge proof | Not claimed |

## Threat Model

The main scientific and operational threats are:

- Confusing software test success with trading edge.
- Allowing strategy code to bypass risk or execution boundaries.
- Replaying fills incorrectly after restart.
- Treating malformed or stale market metadata as tradable.
- Failing to distinguish local simulation, demo execution, and live execution.
- Accidentally committing secrets or runtime state.

## Publication Standard

A public release should be judged by:

- Clear separation between claims and evidence.
- Reproducible test command.
- Minimal tracked runtime artifacts.
- Explicit disclaimers.
- Security guidance for secrets and live trading.
- No unsupported profitability language.

## Next Research Gates

1. Expand exchange-adapter tests with mocked Polymarket responses.
2. Add lifecycle state-machine tests for order submission, cancellation, fill, and terminal states.
3. Add recovery tests for restart after partial persistence.
4. Add metrics and structured logging acceptance tests.
5. Add a documented shadow-mode protocol before any live capital path.
