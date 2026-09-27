import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import express from "express";

import { EXPORTS_DIR, GRAPH_PATH, resolveSqlitePath } from "./paths.js";
import { createLiveStateRouter } from "./liveState.js";

type ExportFormat = "png" | "svg" | "pdf";

interface ExportRequest {
  format: ExportFormat;
  filename: string;
  data: string;
  encoding?: "base64" | "utf8";
}

interface JaegerServicesResponse {
  data?: string[];
}

interface JaegerTracesResponse {
  data?: Array<{
    traceID: string;
    spans: Array<{
      operationName: string;
      processID: string;
      tags?: Array<{ key: string; value: unknown }>;
    }>;
    processes?: Record<
      string,
      {
        serviceName?: string;
        tags?: Array<{ key: string; value: unknown }>;
      }
    >;
  }>;
}

function sanitizeFilename(filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  if (safe.length === 0) {
    return "architecture_export";
  }
  return safe;
}

function ensureExtension(filename: string, format: ExportFormat): string {
  return filename.toLowerCase().endsWith(`.${format}`)
    ? filename
    : `${filename}.${format}`;
}

function decodeExportData(payload: ExportRequest): Buffer {
  const encoding = payload.encoding ?? "base64";
  if (encoding === "utf8") {
    return Buffer.from(payload.data, "utf8");
  }
  return Buffer.from(payload.data, "base64");
}

async function readJaegerServices(jaegerBaseUrl: string): Promise<string[]> {
  const response = await fetch(`${jaegerBaseUrl}/api/services`);
  if (!response.ok) {
    throw new Error(`Jaeger services request failed: ${response.status}`);
  }

  const json = (await response.json()) as JaegerServicesResponse;
  return json.data ?? [];
}

async function readJaegerTraces(
  jaegerBaseUrl: string,
  serviceName: string,
  limit: number,
): Promise<JaegerTracesResponse> {
  const endpoint = `${jaegerBaseUrl}/api/traces?service=${encodeURIComponent(serviceName)}&limit=${limit}&lookback=1h`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Jaeger traces request failed: ${response.status}`);
  }
  return (await response.json()) as JaegerTracesResponse;
}

function extractHighlights(traces: JaegerTracesResponse): string[] {
  const highlights = new Set<string>();

  for (const trace of traces.data ?? []) {
    for (const span of trace.spans) {
      highlights.add(span.operationName);
      for (const tag of span.tags ?? []) {
        if (tag.key === "component" && typeof tag.value === "string") {
          highlights.add(tag.value);
        }
      }
    }
  }

  return [...highlights];
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "25mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/graph", (_req, res) => {
    if (!fs.existsSync(GRAPH_PATH)) {
      res.status(404).json({
        error: "architecture_graph.json not found",
        hint: "Run backend graph generation first: npm run generate",
      });
      return;
    }

    const graph = fs.readFileSync(GRAPH_PATH, "utf8");
    res.type("application/json").send(graph);
  });

  app.post("/api/export", (req, res) => {
    const payload = req.body as Partial<ExportRequest>;

    if (!payload.format || !payload.filename || !payload.data) {
      res.status(400).json({
        error: "Invalid export payload. format, filename, and data are required.",
      });
      return;
    }

    if (!["png", "svg", "pdf"].includes(payload.format)) {
      res.status(400).json({ error: "Unsupported format" });
      return;
    }

    const format = payload.format as ExportFormat;
    const safeFilename = ensureExtension(sanitizeFilename(payload.filename), format);

    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    const exportPath = path.resolve(EXPORTS_DIR, safeFilename);

    const fileBuffer = decodeExportData(payload as ExportRequest);
    fs.writeFileSync(exportPath, fileBuffer);

    res.json({
      status: "saved",
      path: exportPath,
    });
  });

  const jaegerBaseUrlForLive =
    process.env.JAEGER_URL?.replace(/\/$/, "") ?? "http://localhost:16686";
  const sqlitePath = resolveSqlitePath();
  app.use("/api/live", createLiveStateRouter(sqlitePath, jaegerBaseUrlForLive));

  app.get("/api/traces", async (req, res) => {
    const jaegerBaseUrl =
      process.env.JAEGER_URL?.replace(/\/$/, "") ?? "http://localhost:16686";
    const limit = Number.parseInt((req.query.limit as string) ?? "20", 10);

    try {
      const services = await readJaegerServices(jaegerBaseUrl);
      if (services.length === 0) {
        res.json({
          status: "no_traces",
          traces: [],
          highlights: [],
          message: "No runtime traces detected",
        });
        return;
      }

      const requestedService = req.query.service as string | undefined;
      const serviceName =
        (requestedService && services.includes(requestedService)
          ? requestedService
          : services[0]) ?? "";

      if (!serviceName) {
        res.json({
          status: "no_traces",
          traces: [],
          highlights: [],
          message: "No runtime traces detected",
        });
        return;
      }

      const traces = await readJaegerTraces(jaegerBaseUrl, serviceName, limit);
      const traceData = traces.data ?? [];

      if (traceData.length === 0) {
        res.json({
          status: "no_traces",
          service: serviceName,
          traces: [],
          highlights: [],
          message: "No runtime traces detected",
        });
        return;
      }

      res.json({
        status: "ok",
        service: serviceName,
        traces: traceData,
        highlights: extractHighlights(traces),
      });
    } catch (error) {
      res.json({
        status: "no_traces",
        traces: [],
        highlights: [],
        message: "No runtime traces detected",
        detail: error instanceof Error ? error.message : "unknown",
      });
    }
  });

  return app;
}

function main(): void {
  const app = createApp();
  const port = Number.parseInt(process.env.ATLAS_BACKEND_PORT ?? "8787", 10);

  app.listen(port, () => {
    process.stdout.write(`Architecture Atlas backend listening on http://localhost:${port}\n`);
  });
}

const entryUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;

if (entryUrl === import.meta.url) {
  main();
}
