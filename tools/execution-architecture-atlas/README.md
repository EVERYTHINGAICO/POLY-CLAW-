# Execution Architecture Atlas

The Execution Architecture Atlas is a local visualization and observability workbench for POLY-CLAW. It turns the Rust workspace, execution pipeline, and operational surfaces into an inspectable architecture map.

The atlas is deliberately external to the Rust workspace. It does not modify `Cargo.toml`, does not add Rust dependencies, and can be installed, regenerated, or removed without changing the execution core.

## Purpose

The atlas exists to make the system reviewable at research and engineering depth:

- crate and module topology
- dependency direction and reverse-dependency review
- execution authority boundaries
- risk, intent, execution, fill, reconciliation, and storage surfaces
- operational panels for state, events, capital, positions, alerts, session playback, and preflight status
- exportable architecture evidence for technical review

It is a visualization layer, not a trading component.

## Layout

```text
tools/execution-architecture-atlas/
  backend/     graph generation, API server, export command, optional trace bridge
  data/        generated architecture graph
  docker/      optional Jaeger compose file
  frontend/    React + Vite + Three.js 3D atlas UI
  README.md
```

Generated artifacts are intentionally excluded from git:

- `backend/node_modules/`
- `backend/dist/`
- `frontend/node_modules/`
- `frontend/dist/`
- `exports/`

## Prerequisites

- Node.js 20+ recommended
- npm
- Rust toolchain with `cargo`
- Optional: Docker Desktop for Jaeger trace exploration

## Install

From the repository root:

```bash
cd tools/execution-architecture-atlas/backend
npm ci

cd ../frontend
npm ci
```

## Generate Architecture Graph

From `tools/execution-architecture-atlas/backend`:

```bash
npm run generate -- --workspace ../..
```

This updates:

```text
tools/execution-architecture-atlas/data/architecture_graph.json
tools/execution-architecture-atlas/frontend/public/data/architecture_graph.json
```

## Run Locally

Start the backend:

```bash
cd tools/execution-architecture-atlas/backend
npm run serve
```

Backend URL:

```text
http://localhost:8787
```

Start the frontend:

```bash
cd tools/execution-architecture-atlas/frontend
npm run dev
```

Frontend URL:

```text
http://localhost:5173
```

## Validation

Backend:

```bash
cd tools/execution-architecture-atlas/backend
npm run typecheck
```

Frontend:

```bash
cd tools/execution-architecture-atlas/frontend
npm run build
```

The current local preparation passed both commands. The frontend build may warn about large 3D visualization chunks; that warning is expected for the current Three.js/react-force-graph bundle and does not fail the build.

## Graph Layers

The atlas supports:

1. Workspace architecture: crate nodes and crate-dependency edges.
2. Module architecture: module nodes and source-location metadata.
3. Execution pipeline: market data, strategy, risk engine, intent queue, execution engine, adapter boundary, reconciliation, and storage.
4. Execution internals: authority, coordinator, retry/dead-letter concepts, event tracing, and fill handling.
5. Operational state surfaces: vitals, timeline, state machines, preflight, positions, capital, alerts, session playback, and annotations.

## Exports

Exports are written under `tools/execution-architecture-atlas/exports/`, which is ignored by git.

Example:

```bash
cd tools/execution-architecture-atlas/backend
npm run export -- --focus execution_engine --depth 2 --formats svg,png,pdf --name execution_engine_architecture
```

## Optional Jaeger Overlay

From `tools/execution-architecture-atlas/docker`:

```bash
docker compose up -d
```

Jaeger UI:

```text
http://localhost:16686
```

If traces are unavailable, the atlas should remain usable and report that no runtime traces were detected.

## Research Interpretation

The atlas is evidence infrastructure. It helps reviewers inspect system structure, boundaries, and operational assumptions. It does not prove profitability, exchange readiness, or live trading safety.
