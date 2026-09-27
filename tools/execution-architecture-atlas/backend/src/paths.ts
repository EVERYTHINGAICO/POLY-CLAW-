import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_ROOT = path.resolve(srcDir, "..");
export const ATLAS_ROOT = path.resolve(BACKEND_ROOT, "..");

export const DEFAULT_WORKSPACE = path.resolve(
  ATLAS_ROOT,
  "..",
  "polymarket-execution-system",
);
export const FALLBACK_WORKSPACE = path.resolve(
  ATLAS_ROOT,
  "..",
  "polymarket-execution-system-sandbox",
);

export const DATA_DIR = path.resolve(ATLAS_ROOT, "data");
export const FRONTEND_PUBLIC_DATA_DIR = path.resolve(
  ATLAS_ROOT,
  "frontend",
  "public",
  "data",
);
export const EXPORTS_DIR = path.resolve(ATLAS_ROOT, "exports");

export const GRAPH_PATH = path.resolve(DATA_DIR, "architecture_graph.json");
export const FRONTEND_GRAPH_PATH = path.resolve(
  FRONTEND_PUBLIC_DATA_DIR,
  "architecture_graph.json",
);

export function resolveSqlitePath(): string {
  if (process.env.ATLAS_SQLITE_PATH) {
    return process.env.ATLAS_SQLITE_PATH;
  }

  const candidates = [
    path.resolve(DEFAULT_WORKSPACE, "target", "ops-cli-runtime", "ops_cli_runtime.db"),
    path.resolve(ATLAS_ROOT, "..", "core", "polymarket-execution-system", "target", "ops-cli-runtime", "ops_cli_runtime.db"),
    path.resolve(FALLBACK_WORKSPACE, "target", "ops-cli-runtime", "ops_cli_runtime.db"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[0]!;
}
