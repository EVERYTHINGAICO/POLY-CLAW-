import fs from "node:fs";
import path from "node:path";

import PDFDocument from "pdfkit";
import { Resvg } from "@resvg/resvg-js";

import { EXPORTS_DIR, GRAPH_PATH } from "./paths.js";
import type { AtlasEdge, AtlasGraph, AtlasLayer, AtlasNode } from "./types.js";

type ExportFormat = "svg" | "png" | "pdf";

interface CliOptions {
  inputPath: string;
  focus?: string;
  depth: number;
  formats: ExportFormat[];
  name?: string;
}

interface Point {
  x: number;
  y: number;
}

interface Subgraph {
  nodes: AtlasNode[];
  edges: AtlasEdge[];
}

const WIDTH = 1600;
const HEIGHT = 1000;

const LAYER_ORDER: AtlasLayer[] = [
  "workspace",
  "module",
  "pipeline",
  "engine_internals",
];

function parseCliArgs(argv: string[]): CliOptions {
  const args = [...argv];
  let inputPath = GRAPH_PATH;
  let focus: string | undefined;
  let depth = 2;
  let formats: ExportFormat[] = ["svg", "png", "pdf"];
  let name: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];

    if ((arg === "--input" || arg === "-i") && next) {
      inputPath = path.resolve(next);
      i += 1;
      continue;
    }

    if ((arg === "--focus" || arg === "-f") && next) {
      focus = next;
      i += 1;
      continue;
    }

    if ((arg === "--depth" || arg === "-d") && next) {
      depth = Number.parseInt(next, 10);
      i += 1;
      continue;
    }

    if ((arg === "--formats" || arg === "-m") && next) {
      formats = next
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter((value): value is ExportFormat =>
          ["svg", "png", "pdf"].includes(value),
        );
      i += 1;
      continue;
    }

    if ((arg === "--name" || arg === "-n") && next) {
      name = next;
      i += 1;
    }
  }

  return {
    inputPath,
    focus,
    depth: Number.isNaN(depth) ? 2 : Math.max(0, depth),
    formats,
    name,
  };
}

function readGraph(inputPath: string): AtlasGraph {
  const raw = fs.readFileSync(inputPath, "utf8");
  return JSON.parse(raw) as AtlasGraph;
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

function resolveFocusNode(graph: AtlasGraph, focus: string): AtlasNode | undefined {
  const target = normalize(focus);

  const exact = graph.nodes.find((node) => normalize(node.id) === target);
  if (exact) {
    return exact;
  }

  const label = graph.nodes.find((node) => normalize(node.label) === target);
  if (label) {
    return label;
  }

  return graph.nodes.find((node) => normalize(node.id).includes(target));
}

function buildAdjacency(edges: AtlasEdge[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();

  for (const edge of edges) {
    if (!adjacency.has(edge.source)) {
      adjacency.set(edge.source, new Set<string>());
    }
    if (!adjacency.has(edge.target)) {
      adjacency.set(edge.target, new Set<string>());
    }

    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  return adjacency;
}

function filterSubgraph(graph: AtlasGraph, focus: string | undefined, depth: number): Subgraph {
  if (!focus) {
    return { nodes: graph.nodes, edges: graph.edges };
  }

  const focusNode = resolveFocusNode(graph, focus);
  if (!focusNode) {
    return { nodes: graph.nodes, edges: graph.edges };
  }

  const adjacency = buildAdjacency(graph.edges);
  const visited = new Set<string>([focusNode.id]);
  const queue: Array<{ id: string; distance: number }> = [
    { id: focusNode.id, distance: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    if (current.distance >= depth) {
      continue;
    }

    const neighbors = adjacency.get(current.id);
    if (!neighbors) {
      continue;
    }

    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) {
        continue;
      }

      visited.add(neighbor);
      queue.push({ id: neighbor, distance: current.distance + 1 });
    }
  }

  const nodes = graph.nodes.filter((node) => visited.has(node.id));
  const edgeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) => edgeIds.has(edge.source) && edgeIds.has(edge.target),
  );

  return { nodes, edges };
}

function layoutNodes(nodes: AtlasNode[]): Map<string, Point> {
  const positions = new Map<string, Point>();
  const byLayer = new Map<AtlasLayer, AtlasNode[]>();

  for (const layer of LAYER_ORDER) {
    byLayer.set(layer, []);
  }

  for (const node of nodes) {
    const bucket = byLayer.get(node.layer);
    if (bucket) {
      bucket.push(node);
    } else {
      byLayer.set(node.layer, [node]);
    }
  }

  const activeLayers = LAYER_ORDER.filter((layer) => (byLayer.get(layer)?.length ?? 0) > 0);
  const spacing = WIDTH / (activeLayers.length + 1);

  activeLayers.forEach((layer, index) => {
    const layerNodes = byLayer.get(layer) ?? [];
    const centerX = spacing * (index + 1);
    const centerY = HEIGHT / 2;

    if (layerNodes.length === 1) {
      positions.set(layerNodes[0]!.id, { x: centerX, y: centerY });
      return;
    }

    const radius = Math.min(220, 60 + layerNodes.length * 4);

    layerNodes
      .sort((a, b) => a.label.localeCompare(b.label))
      .forEach((node, nodeIndex) => {
        const angle = (2 * Math.PI * nodeIndex) / layerNodes.length;
        positions.set(node.id, {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        });
      });
  });

  for (const node of nodes) {
    if (!positions.has(node.id)) {
      positions.set(node.id, { x: WIDTH / 2, y: HEIGHT / 2 });
    }
  }

  return positions;
}

function colorForNode(node: AtlasNode): string {
  if (node.layer === "pipeline") {
    return "#7c3aed";
  }
  if (node.layer === "engine_internals") {
    return "#b91c1c";
  }

  if (node.nodeType === "crate") {
    return node.external ? "#6b7280" : "#1d4ed8";
  }
  if (node.nodeType === "module") {
    return "#059669";
  }
  return "#ea580c";
}

function radiusForNode(node: AtlasNode): number {
  if (node.nodeType === "crate") {
    return 14;
  }
  if (node.nodeType === "module") {
    return 10;
  }
  return 7;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderSvg(subgraph: Subgraph, positions: Map<string, Point>): string {
  const nodeById = new Map(subgraph.nodes.map((node) => [node.id, node]));

  const edgeLines = subgraph.edges
    .map((edge) => {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      if (!source || !target) {
        return "";
      }

      return `<line x1="${source.x.toFixed(2)}" y1="${source.y.toFixed(2)}" x2="${target.x.toFixed(2)}" y2="${target.y.toFixed(2)}" stroke="#64748b" stroke-width="1.2" opacity="0.6" />`;
    })
    .join("\n");

  const nodeShapes = subgraph.nodes
    .map((node) => {
      const point = positions.get(node.id);
      if (!point) {
        return "";
      }

      const radius = radiusForNode(node);
      const fill = colorForNode(node);
      const label = escapeXml(node.label);
      const type = escapeXml(`${node.nodeType} (${node.layer})`);

      return [
        `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${radius}" fill="${fill}" opacity="0.95" />`,
        `<text x="${(point.x + radius + 4).toFixed(2)}" y="${(point.y + 4).toFixed(2)}" font-size="11" fill="#0f172a" font-family="Arial, sans-serif">${label}</text>`,
        `<text x="${(point.x + radius + 4).toFixed(2)}" y="${(point.y + 16).toFixed(2)}" font-size="9" fill="#475569" font-family="Arial, sans-serif">${type}</text>`,
      ].join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="100%" height="100%" fill="#f8fafc" />
  ${edgeLines}
  ${nodeShapes}
</svg>
`;
}

function renderPdf(
  subgraph: Subgraph,
  positions: Map<string, Point>,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [WIDTH, HEIGHT], margin: 0 });
    const stream = fs.createWriteStream(outputPath);

    doc.pipe(stream);

    doc.rect(0, 0, WIDTH, HEIGHT).fill("#f8fafc");

    for (const edge of subgraph.edges) {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      if (!source || !target) {
        continue;
      }

      doc
        .moveTo(source.x, source.y)
        .lineTo(target.x, target.y)
        .strokeColor("#94a3b8")
        .lineWidth(1)
        .stroke();
    }

    for (const node of subgraph.nodes) {
      const point = positions.get(node.id);
      if (!point) {
        continue;
      }

      const radius = radiusForNode(node);
      const fill = colorForNode(node);
      doc.circle(point.x, point.y, radius).fill(fill);

      doc
        .fillColor("#0f172a")
        .fontSize(10)
        .text(node.label, point.x + radius + 4, point.y - 2, { lineBreak: false });

      doc
        .fillColor("#475569")
        .fontSize(8)
        .text(`${node.nodeType} (${node.layer})`, point.x + radius + 4, point.y + 10, {
          lineBreak: false,
        });
    }

    doc.end();

    stream.on("finish", () => resolve());
    stream.on("error", (error) => reject(error));
  });
}

function buildFileBase(name: string | undefined, focus: string | undefined): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  if (name) {
    return name.replace(/[^A-Za-z0-9_-]/g, "_");
  }

  const focusPart = (focus ?? "full_architecture").replace(/[^A-Za-z0-9_-]/g, "_");
  return `${focusPart}_${timestamp}`;
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));

  if (!fs.existsSync(options.inputPath)) {
    throw new Error(`Graph file not found: ${options.inputPath}`);
  }

  const graph = readGraph(options.inputPath);
  const subgraph = filterSubgraph(graph, options.focus, options.depth);
  const positions = layoutNodes(subgraph.nodes);

  fs.mkdirSync(EXPORTS_DIR, { recursive: true });

  const fileBase = buildFileBase(options.name, options.focus);
  const createdFiles: string[] = [];

  if (options.formats.includes("svg")) {
    const svg = renderSvg(subgraph, positions);
    const svgPath = path.resolve(EXPORTS_DIR, `${fileBase}.svg`);
    fs.writeFileSync(svgPath, svg, "utf8");
    createdFiles.push(svgPath);

    if (options.formats.includes("png")) {
      const pngPath = path.resolve(EXPORTS_DIR, `${fileBase}.png`);
      const resvg = new Resvg(svg, {
        fitTo: { mode: "width", value: WIDTH },
      });
      const pngData = resvg.render();
      fs.writeFileSync(pngPath, pngData.asPng());
      createdFiles.push(pngPath);
    }
  } else if (options.formats.includes("png")) {
    throw new Error("PNG export requires SVG rendering. Include svg in --formats.");
  }

  if (options.formats.includes("pdf")) {
    const pdfPath = path.resolve(EXPORTS_DIR, `${fileBase}.pdf`);
    await renderPdf(subgraph, positions, pdfPath);
    createdFiles.push(pdfPath);
  }

  const result = {
    focus: options.focus ?? "full",
    depth: options.depth,
    nodeCount: subgraph.nodes.length,
    edgeCount: subgraph.edges.length,
    createdFiles,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

void main();
