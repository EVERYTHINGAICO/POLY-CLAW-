import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
import { jsPDF } from "jspdf";

import {
  dependenciesForNode,
  dependencyCountMap,
  edgeEndpoints,
  filterGraph,
  layersDefault,
  nodeById,
  nodeMatchesTrace,
  reverseDependenciesForNode,
} from "./graphUtils";
import type {
  AtlasGraph,
  AtlasLayer,
  ForceLink,
  ForceNode,
  GraphData,
  TraceResponse,
} from "./types";
import { useLiveState } from "./hooks/useLiveState";
import { useEventStream } from "./hooks/useEventStream";
import { useAnomalyDetector } from "./hooks/useAnomalyDetector";
import { useAudioAlerts } from "./hooks/useAudioAlerts";
import { useVoiceReadout } from "./hooks/useVoiceReadout";
import { useCustomAlerts, type AlertRule } from "./hooks/useCustomAlerts";
import { useLatencyData } from "./hooks/useLatencyData";
import { useSessionRecorder } from "./hooks/useSessionRecorder";
import { useTimeTravel } from "./hooks/useTimeTravel";
import { SystemStatusBar } from "./components/SystemStatusBar";
import { StateMachinePanel } from "./components/StateMachinePanel";
import { CapitalGauge } from "./components/CapitalGauge";
import { PositionsSummaryPanel } from "./components/PositionsSummary";
import { FundsTimeline } from "./components/FundsTimeline";
import { PreflightPanel, ReadinessIndicator } from "./components/PreflightPanel";
import { EventTimeline } from "./components/EventTimeline";
import { VitalsHUD } from "./components/VitalsHUD";
import { AnnotationEditor } from "./components/AnnotationEditor";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import { AlertRulesPanel } from "./components/AlertRulesPanel";
import { SessionPlayback } from "./components/SessionPlayback";
import { TimelineScrubber } from "./components/TimelineScrubber";
import type { LiveSummary } from "./types/liveState";

const ALL_LAYERS: AtlasLayer[] = [
  "workspace",
  "module",
  "pipeline",
  "engine_internals",
];

const PRESET_NAMES = [
  "Topology View",
  "Pipeline View",
  "Engine Internals",
  "Dependency Cloud",
  "Mission Control",
] as const;

type PresetName = (typeof PRESET_NAMES)[number];

function safeFilename(base: string): string {
  return base.replace(/[^A-Za-z0-9._-]/g, "_");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function nodeRadius(node: ForceNode): number {
  if (node.nodeType === "crate") {
    return 8;
  }
  if (node.nodeType === "module") {
    return 6;
  }
  return 4;
}

function nodeColor(node: ForceNode): string {
  if (node.layer === "pipeline") {
    return "#0ea5e9";
  }
  if (node.layer === "engine_internals") {
    return "#ef4444";
  }

  if (node.nodeType === "crate") {
    return node.external ? "#64748b" : "#2563eb";
  }
  if (node.nodeType === "module") {
    return "#14b8a6";
  }
  return "#f97316";
}

const PIPELINE_STAGES = new Set([
  "market_data", "strategy", "risk_engine", "intent_queue",
  "execution_engine", "polymarket_adapter",
]);

const PIPELINE_STAGE_ORDER = [
  "market_data", "strategy", "risk_engine", "intent_queue",
  "execution_engine", "polymarket_adapter",
];

function pipelineNodeHealth(node: ForceNode, live: LiveSummary | null): "healthy" | "warn" | "critical" | null {
  if (!live || live.status !== "ok") return null;
  if (node.layer !== "pipeline") return null;

  const label = node.label.toLowerCase();
  const crate = (node.crate ?? "").toLowerCase();
  const match = [...PIPELINE_STAGES].find((s) => label.includes(s) || crate.includes(s));
  if (!match) return null;

  if (match === "strategy") {
    return live.intents.queued + live.intents.in_flight + live.intents.submitted + live.intents.done > 0 ? "healthy" : "warn";
  }
  if (match === "risk_engine") {
    return live.intents.failed > 0 ? "warn" : "healthy";
  }
  if (match === "intent_queue") {
    if (live.intents.queued > 100) return "critical";
    if (live.intents.queued > 50) return "warn";
    return "healthy";
  }
  if (match === "execution_engine") {
    if (live.dlq.count > 0) return "critical";
    if (live.intents.in_flight > 20) return "warn";
    return "healthy";
  }
  if (match === "market_data" || match === "polymarket_adapter") {
    const tradingCount = live.markets.by_lifecycle["TRADING"] ?? 0;
    return tradingCount > 0 ? "healthy" : "warn";
  }

  return null;
}

const HEALTH_COLORS = {
  healthy: "#22c55e",
  warn: "#f59e0b",
  critical: "#ef4444",
};

function toBase64DataUri(dataUri: string): string {
  const split = dataUri.split(",");
  return split[1] ?? "";
}

function buildSvg(graphData: GraphData): string {
  const width = 1400;
  const height = 900;

  const fallbackRadius = 220;

  const rawPoints = graphData.nodes.map((node, index) => {
    const hasPosition =
      typeof node.x === "number" &&
      Number.isFinite(node.x) &&
      typeof node.y === "number" &&
      Number.isFinite(node.y);

    if (hasPosition) {
      return { id: node.id, x: node.x as number, y: node.y as number };
    }

    const angle = (2 * Math.PI * index) / Math.max(1, graphData.nodes.length);
    return {
      id: node.id,
      x: fallbackRadius * Math.cos(angle),
      y: fallbackRadius * Math.sin(angle),
    };
  });

  const xs = rawPoints.map((point) => point.x);
  const ys = rawPoints.map((point) => point.y);
  const minX = Math.min(...xs, -1);
  const maxX = Math.max(...xs, 1);
  const minY = Math.min(...ys, -1);
  const maxY = Math.max(...ys, 1);

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);

  const points = new Map<string, { x: number; y: number }>();
  for (const point of rawPoints) {
    const x = ((point.x - minX) / spanX) * (width - 160) + 80;
    const y = ((point.y - minY) / spanY) * (height - 120) + 60;
    points.set(point.id, { x, y });
  }

  const nodeLookup = new Map(graphData.nodes.map((node) => [node.id, node]));

  const edgeSvg = graphData.links
    .map((link) => {
      const { sourceId, targetId } = edgeEndpoints(link);
      const source = points.get(sourceId);
      const target = points.get(targetId);
      if (!source || !target) {
        return "";
      }

      return `<line x1="${source.x.toFixed(2)}" y1="${source.y.toFixed(2)}" x2="${target.x.toFixed(2)}" y2="${target.y.toFixed(2)}" stroke="#64748b" stroke-width="1.2" opacity="0.6"/>`;
    })
    .join("\n");

  const nodeSvg = graphData.nodes
    .map((node) => {
      const point = points.get(node.id);
      if (!point) {
        return "";
      }

      const radius = nodeRadius(node) + 4;
      const color = nodeColor(node);
      const safeLabel = escapeXml(node.label);
      const safeMeta = escapeXml(`${node.nodeType} (${node.layer})`);

      return [
        `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${radius}" fill="${color}"/>`,
        `<text x="${(point.x + radius + 4).toFixed(2)}" y="${(point.y + 4).toFixed(2)}" font-size="11" fill="#e2e8f0" font-family="IBM Plex Sans, Segoe UI, sans-serif">${safeLabel}</text>`,
        `<text x="${(point.x + radius + 4).toFixed(2)}" y="${(point.y + 16).toFixed(2)}" font-size="9" fill="#94a3b8" font-family="IBM Plex Sans, Segoe UI, sans-serif">${safeMeta}</text>`,
      ].join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#020617"/>
  ${edgeSvg}
  ${nodeSvg}
</svg>`;
}

function App() {
  const fgRef = useRef<any>(null);

  const [graph, setGraph] = useState<AtlasGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [focusDepth, setFocusDepth] = useState(2);
  const [includeExternal, setIncludeExternal] = useState(false);
  const [workspaceOnly, setWorkspaceOnly] = useState(false);
  const [enabledLayers, setEnabledLayers] = useState<Set<AtlasLayer>>(new Set(ALL_LAYERS));
  const [traceHighlights, setTraceHighlights] = useState<Set<string>>(new Set());
  const [traceStatusText, setTraceStatusText] = useState("No runtime traces detected");
  const [activePreset, setActivePreset] = useState<PresetName>("Topology View");
  const [exportStatus, setExportStatus] = useState<string>("");
  const [graphSize, setGraphSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);

  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [legendVisible, setLegendVisible] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<ForceNode | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [showOnboarding, setShowOnboarding] = useState(
    () => !localStorage.getItem("atlas-onboarding-dismissed"),
  );

  const { data: liveData, isLive, lastUpdated: liveLastUpdated } = useLiveState(2000);
  const { events } = useEventStream(3000);
  const { hasAnomaly } = useAnomalyDetector(liveData);
  const [rightTab, setRightTab] = useState<"inspector" | "state_machines" | "positions" | "events" | "alerts">("inspector");
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [tacticalMode, setTacticalMode] = useState(false);
  const [vitalsVisible, setVitalsVisible] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [incidentTraceIntentId, setIncidentTraceIntentId] = useState<string | null>(null);

  // F8: Node Annotations
  const [annotations, setAnnotations] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("atlas-annotations") || "{}"); } catch { return {}; }
  });
  const [annotationTarget, setAnnotationTarget] = useState<{ nodeId: string; label: string; pos: { x: number; y: number } } | null>(null);

  // F9: Command Palette
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // F10: CAPCOM Voice
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceVerbosity, setVoiceVerbosity] = useState<"critical" | "all">("critical");

  // F11: Custom Alert Rules
  const [alertRules, setAlertRules] = useState<AlertRule[]>(() => {
    try { return JSON.parse(localStorage.getItem("atlas-alert-rules") || "[]"); } catch { return []; }
  });

  // F12: Latency Overlay
  const [latencyOverlay, setLatencyOverlay] = useState(false);

  // F13: Session Recording
  const [sessionPlaybackOpen, setSessionPlaybackOpen] = useState(false);

  // F15: Time Travel
  const timeTravel = useTimeTravel();
  const effectiveLiveData = timeTravel.mode === "replay" && timeTravel.replayData ? timeTravel.replayData : liveData;

  useAudioAlerts(audioEnabled, effectiveLiveData);
  useVoiceReadout(voiceEnabled, voiceVerbosity, effectiveLiveData);
  const { latencyMap } = useLatencyData(latencyOverlay);
  const { recording, snapshots, startRecording, stopRecording, clearSnapshots } = useSessionRecorder(fgRef);
  const { firedRules } = useCustomAlerts(alertRules, effectiveLiveData);

  // Window resize → graph fills viewport
  useEffect(() => {
    const handleResize = () => {
      setGraphSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Fullscreen API sync
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }, []);

  // Configure Three.js OrbitControls for smoother navigation
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    let frameId: number | null = null;

    const configure = () => {
      const controls = typeof fg.controls === "function" ? fg.controls() : fg.controls;
      if (!controls) return;

      controls.enableDamping = true;
      controls.dampingFactor = 0.12;
      controls.rotateSpeed = 0.8;
      controls.zoomSpeed = 1.2;
      controls.minDistance = 50;
      controls.maxDistance = 2000;
      controls.enablePan = true;
      controls.autoRotate = autoRotate;
      controls.autoRotateSpeed = 0.5;

      // Animation loop — required for damping + autoRotate to work
      const tick = () => {
        controls.update();
        frameId = requestAnimationFrame(tick);
      };
      tick();
    };

    // Controls may not be ready immediately
    const timer = setTimeout(configure, 500);
    return () => {
      clearTimeout(timer);
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [autoRotate]);

  // Save annotations & alert rules to localStorage
  useEffect(() => {
    localStorage.setItem("atlas-annotations", JSON.stringify(annotations));
  }, [annotations]);

  useEffect(() => {
    localStorage.setItem("atlas-alert-rules", JSON.stringify(alertRules));
  }, [alertRules]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

      // Ctrl+K / Meta+K — Command Palette
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
        return;
      }

      if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      } else if (e.key === "r" && !e.shiftKey) {
        const fg = fgRef.current;
        fg?.cameraPosition?.({ x: 0, y: 0, z: 680 }, undefined, 1200);
      } else if (e.key === "R" && e.shiftKey) {
        // Shift+R — Toggle recording
        if (recording) stopRecording(); else startRecording();
      } else if (e.key === " ") {
        e.preventDefault();
        setAutoRotate((prev) => !prev);
      } else if (e.key === "t" || e.key === "T") {
        setTacticalMode((prev) => !prev);
      } else if (e.key === "v" || e.key === "V") {
        setVitalsVisible((prev) => !prev);
      } else if (e.key === "a" || e.key === "A") {
        setAudioEnabled((prev) => !prev);
      } else if (e.key === "c" || e.key === "C") {
        setVoiceEnabled((prev) => !prev);
      } else if (e.key === "l" || e.key === "L") {
        setLatencyOverlay((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [toggleFullscreen, recording, startRecording, stopRecording]);

  useEffect(() => {
    let cancelled = false;

    const loadGraph = async () => {
      setLoading(true);
      setError(null);
      let loaded = false;

      const endpoints = ["/api/graph", "/data/architecture_graph.json"];

      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint);
          if (!response.ok) {
            continue;
          }

          const parsed = (await response.json()) as AtlasGraph;
          if (!cancelled) {
            setGraph(parsed);
            setEnabledLayers(layersDefault(parsed));
            setSelectedNodeId(parsed.nodes[0]?.id);
            loaded = true;
          }
          break;
        } catch {
          // Ignore endpoint errors and try fallback.
        }
      }

      if (!cancelled && !loaded) {
        setError("Unable to load architecture graph. Run backend generation first.");
      }

      if (!cancelled) {
        setLoading(false);
      }
    };

    void loadGraph();

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshTraces = async () => {
    try {
      const response = await fetch("/api/traces?limit=20");
      if (!response.ok) {
        setTraceHighlights(new Set());
        setTraceStatusText("No runtime traces detected");
        return;
      }

      const payload = (await response.json()) as TraceResponse;
      if (payload.status === "ok") {
        const highlights = new Set(payload.highlights ?? []);
        setTraceHighlights(highlights);
        setTraceStatusText(
          `Rust Traces: ${payload.service ?? "connected"}`,
        );
        return;
      }

      setTraceHighlights(new Set());
      setTraceStatusText(payload.message ?? "No runtime traces detected");
    } catch {
      setTraceHighlights(new Set());
      setTraceStatusText("No runtime traces detected");
    }
  };

  useEffect(() => {
    void refreshTraces();
  }, []);

  const filteredGraph = useMemo<GraphData>(() => {
    if (!graph) {
      return { nodes: [], links: [] };
    }

    return filterGraph(graph, {
      includeExternal,
      workspaceOnly,
      enabledLayers,
      focusMode,
      focusNodeId: selectedNodeId,
      focusDepth,
    });
  }, [
    graph,
    includeExternal,
    workspaceOnly,
    enabledLayers,
    focusMode,
    selectedNodeId,
    focusDepth,
  ]);

  const neighborSet = useMemo(() => {
    if (!selectedNodeId) {
      return new Set<string>();
    }

    const neighbors = new Set<string>();
    for (const link of filteredGraph.links) {
      const { sourceId, targetId } = edgeEndpoints(link);
      if (sourceId === selectedNodeId) {
        neighbors.add(targetId);
      }
      if (targetId === selectedNodeId) {
        neighbors.add(sourceId);
      }
    }
    return neighbors;
  }, [filteredGraph.links, selectedNodeId]);

  const graphNodeMap = useMemo(() => (graph ? nodeById(graph) : new Map<string, ForceNode>()), [graph]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId || !graphNodeMap.has(selectedNodeId)) {
      return undefined;
    }

    return graphNodeMap.get(selectedNodeId);
  }, [graphNodeMap, selectedNodeId]);

  const dependencyIds = useMemo(() => {
    if (!graph || !selectedNodeId) {
      return [];
    }
    return dependenciesForNode(graph, selectedNodeId);
  }, [graph, selectedNodeId]);

  const reverseDependencyIds = useMemo(() => {
    if (!graph || !selectedNodeId) {
      return [];
    }
    return reverseDependenciesForNode(graph, selectedNodeId);
  }, [graph, selectedNodeId]);

  const searchResults = useMemo(() => {
    if (!graph || searchQuery.trim().length === 0) {
      return [];
    }

    const normalizedQuery = searchQuery.toLowerCase().trim();
    return graph.nodes
      .filter(
        (node) =>
          node.id.toLowerCase().includes(normalizedQuery) ||
          node.label.toLowerCase().includes(normalizedQuery),
      )
      .slice(0, 8);
  }, [graph, searchQuery]);

  const focusNodeInGraph = (nodeId: string) => {
    setSelectedNodeId(nodeId);

    const cameraMove = () => {
      const node = filteredGraph.nodes.find((item) => item.id === nodeId);
      const fg = fgRef.current;
      if (!node || !fg || typeof node.x !== "number" || typeof node.y !== "number") {
        return;
      }

      const z = typeof node.z === "number" ? node.z : 0;
      const distance = 100;
      const denominator = Math.hypot(node.x, node.y, z) || 1;
      const ratio = 1 + distance / denominator;

      if (typeof fg.cameraPosition === "function") {
        fg.cameraPosition(
          { x: node.x * ratio, y: node.y * ratio, z: z * ratio },
          node,
          1800,
        );
      }
    };

    window.setTimeout(cameraMove, 280);
  };

  const applyPreset = (preset: PresetName) => {
    setActivePreset(preset);

    const fg = fgRef.current;

    if (preset === "Topology View") {
      setWorkspaceOnly(false);
      setIncludeExternal(false);
      setEnabledLayers(new Set(ALL_LAYERS));
      setFocusMode(false);
      fg?.cameraPosition?.({ x: 0, y: 0, z: 680 }, undefined, 800);
      return;
    }

    if (preset === "Pipeline View") {
      setWorkspaceOnly(false);
      setIncludeExternal(false);
      setEnabledLayers(new Set<AtlasLayer>(["pipeline", "workspace"]));
      setFocusMode(false);
      focusNodeInGraph("module:pipeline::market_data");
      fg?.cameraPosition?.({ x: 0, y: 120, z: 520 }, undefined, 800);
      return;
    }

    if (preset === "Engine Internals") {
      setWorkspaceOnly(false);
      setIncludeExternal(false);
      setEnabledLayers(new Set<AtlasLayer>(["engine_internals", "module", "workspace"]));
      setFocusMode(true);
      setFocusDepth(2);
      focusNodeInGraph("module:execution_engine::internal::coordinator");
      fg?.cameraPosition?.({ x: 180, y: 0, z: 460 }, undefined, 800);
      return;
    }

    if (preset === "Mission Control") {
      setWorkspaceOnly(false);
      setIncludeExternal(false);
      setEnabledLayers(new Set<AtlasLayer>(["pipeline", "engine_internals", "workspace"]));
      setFocusMode(false);
      fg?.cameraPosition?.({ x: 0, y: 60, z: 560 }, undefined, 800);
      return;
    }

    // Dependency Cloud (default)
    setWorkspaceOnly(false);
    setIncludeExternal(true);
    setEnabledLayers(new Set(ALL_LAYERS));
    setFocusMode(false);
    fg?.cameraPosition?.({ x: -90, y: -40, z: 900 }, undefined, 800);
  };

  const toggleLayer = (layer: AtlasLayer) => {
    setEnabledLayers((current) => {
      const next = new Set(current);
      if (next.has(layer)) {
        next.delete(layer);
      } else {
        next.add(layer);
      }
      return next;
    });
  };

  const getCanvas = (): HTMLCanvasElement | null => {
    const fg = fgRef.current;
    if (!fg) {
      return null;
    }

    const renderer = typeof fg.renderer === "function" ? fg.renderer() : fg.renderer;
    const canvas = renderer?.domElement;

    if (canvas instanceof HTMLCanvasElement) {
      return canvas;
    }

    return null;
  };

  const pushExport = async (
    format: "png" | "svg" | "pdf",
    filename: string,
    data: string,
    encoding: "base64" | "utf8",
  ) => {
    const response = await fetch("/api/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ format, filename, data, encoding }),
    });

    if (!response.ok) {
      throw new Error(`Export failed with status ${response.status}`);
    }

    const payload = (await response.json()) as { path?: string };
    setExportStatus(payload.path ? `Saved to ${payload.path}` : "Export saved");
  };

  const currentExportName = selectedNode
    ? `architecture_${safeFilename(selectedNode.label)}`
    : "architecture_overview";

  const exportPng = async () => {
    try {
      const canvas = getCanvas();
      if (!canvas) {
        setExportStatus("Canvas unavailable for PNG export");
        return;
      }

      const pngData = toBase64DataUri(canvas.toDataURL("image/png"));
      await pushExport("png", `${currentExportName}.png`, pngData, "base64");
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : "PNG export failed");
    }
  };

  const exportSvg = async () => {
    try {
      const svg = buildSvg(filteredGraph);
      await pushExport("svg", `${currentExportName}.svg`, svg, "utf8");
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : "SVG export failed");
    }
  };

  const exportPdf = async () => {
    try {
      const canvas = getCanvas();
      if (!canvas) {
        setExportStatus("Canvas unavailable for PDF export");
        return;
      }

      const width = canvas.width;
      const height = canvas.height;
      const orientation = width >= height ? "landscape" : "portrait";
      const pdf = new jsPDF({
        orientation,
        unit: "px",
        format: [width, height],
      });

      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, width, height);
      const pdfBase64 = toBase64DataUri(pdf.output("datauristring"));
      await pushExport("pdf", `${currentExportName}.pdf`, pdfBase64, "base64");
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : "PDF export failed");
    }
  };

  const traceTokens = useMemo(() => new Set([...traceHighlights]), [traceHighlights]);

  const depCounts = useMemo(() => (graph ? dependencyCountMap(graph) : new Map<string, number>()), [graph]);

  const hoveredNeighborSet = useMemo(() => {
    if (!hoveredNode) return new Set<string>();
    const neighbors = new Set<string>();
    for (const link of filteredGraph.links) {
      const { sourceId, targetId } = edgeEndpoints(link);
      if (sourceId === hoveredNode.id) neighbors.add(targetId);
      if (targetId === hoveredNode.id) neighbors.add(sourceId);
    }
    return neighbors;
  }, [filteredGraph.links, hoveredNode]);

  // F3: Throughput heatmap data
  const pipelineThroughput = useMemo(() => {
    if (!effectiveLiveData || effectiveLiveData.status !== "ok") return 0;
    return effectiveLiveData.intents.queued + effectiveLiveData.intents.in_flight +
      effectiveLiveData.intents.submitted + effectiveLiveData.intents.done +
      effectiveLiveData.intents.failed + effectiveLiveData.intents.dlq;
  }, [effectiveLiveData]);

  // F5: Incident root cause trace
  const incidentPath = useMemo(() => {
    const empty = { nodes: new Set<string>(), failNode: null as string | null };
    if (!incidentTraceIntentId || !effectiveLiveData || effectiveLiveData.status !== "ok") return empty;

    const dlqItem = effectiveLiveData.dlq.items.find((i) => i.intent_id === incidentTraceIntentId);
    if (!dlqItem) return empty;

    const reason = dlqItem.reason.toLowerCase();
    let failIndex = PIPELINE_STAGE_ORDER.length - 1;
    for (let i = 0; i < PIPELINE_STAGE_ORDER.length; i++) {
      if (reason.includes(PIPELINE_STAGE_ORDER[i]!)) { failIndex = i; break; }
    }

    const traceNodeIds = new Set<string>();
    let failNodeId: string | null = null;
    for (let i = 0; i <= failIndex; i++) {
      const stage = PIPELINE_STAGE_ORDER[i]!;
      const matchingNode = filteredGraph.nodes.find((n) =>
        n.layer === "pipeline" && (n.label.toLowerCase().includes(stage) || (n.crate ?? "").toLowerCase().includes(stage)),
      );
      if (matchingNode) {
        traceNodeIds.add(matchingNode.id);
        if (i === failIndex) failNodeId = matchingNode.id;
      }
    }

    return { nodes: traceNodeIds, failNode: failNodeId };
  }, [incidentTraceIntentId, effectiveLiveData, filteredGraph.nodes]);

  // F9: Build command palette commands
  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const cmds: PaletteCommand[] = [];

    // Graph nodes
    for (const node of filteredGraph.nodes) {
      cmds.push({ id: `node-${node.id}`, label: node.label, category: "Nodes", action: () => focusNodeInGraph(node.id) });
    }

    // Presets
    for (const preset of PRESET_NAMES) {
      cmds.push({ id: `preset-${preset}`, label: preset, category: "Presets", action: () => applyPreset(preset) });
    }

    // Modes
    cmds.push({ id: "mode-tactical", label: "Toggle Tactical Mode", category: "Modes", action: () => setTacticalMode((p) => !p) });
    cmds.push({ id: "mode-vitals", label: "Toggle Vitals HUD", category: "Modes", action: () => setVitalsVisible((p) => !p) });
    cmds.push({ id: "mode-audio", label: "Toggle Audio Alerts", category: "Modes", action: () => setAudioEnabled((p) => !p) });
    cmds.push({ id: "mode-voice", label: "Toggle CAPCOM Voice", category: "Modes", action: () => setVoiceEnabled((p) => !p) });
    cmds.push({ id: "mode-fullscreen", label: "Toggle Fullscreen", category: "Modes", action: toggleFullscreen });
    cmds.push({ id: "mode-autorotate", label: "Toggle Auto-Rotate", category: "Modes", action: () => setAutoRotate((p) => !p) });
    cmds.push({ id: "mode-latency", label: "Toggle Latency Overlay", category: "Modes", action: () => setLatencyOverlay((p) => !p) });

    // Actions
    cmds.push({ id: "action-png", label: "Export PNG", category: "Actions", action: () => void exportPng() });
    cmds.push({ id: "action-svg", label: "Export SVG", category: "Actions", action: () => void exportSvg() });
    cmds.push({ id: "action-pdf", label: "Export PDF", category: "Actions", action: () => void exportPdf() });
    cmds.push({ id: "action-preflight", label: "Pre-flight Check", category: "Actions", action: () => setPreflightOpen(true) });
    cmds.push({ id: "action-reset-camera", label: "Reset Camera", category: "Actions", action: () => fgRef.current?.cameraPosition?.({ x: 0, y: 0, z: 680 }, undefined, 1200) });
    cmds.push({ id: "action-collapse-left", label: "Toggle Left Panel", category: "Actions", action: () => setLeftPanelOpen((p) => !p) });
    cmds.push({ id: "action-collapse-right", label: "Toggle Right Panel", category: "Actions", action: () => setRightPanelOpen((p) => !p) });
    cmds.push({ id: "action-record", label: recording ? "Stop Recording" : "Start Recording", category: "Actions", action: () => recording ? stopRecording() : startRecording() });

    return cmds;
  }, [filteredGraph.nodes, recording]);

  const shellClassName = [
    "atlas-shell",
    hasAnomaly ? "anomaly-active" : "",
    tacticalMode ? "tactical-mode" : "",
  ].filter(Boolean).join(" ");

  if (loading) {
    return <div className="loading-screen">Loading architecture atlas...</div>;
  }

  if (error || !graph) {
    return <div className="loading-screen">{error ?? "Graph unavailable"}</div>;
  }

  return (
    <div className={shellClassName}>
      {/* Full-viewport 3D graph background */}
      <div
        className="graph-background"
        onMouseMove={(e) => setHoverPos({ x: e.clientX, y: e.clientY })}
      >
        <ForceGraph3D
          ref={fgRef}
          controlType="orbit"
          width={graphSize.width}
          height={graphSize.height}
          graphData={filteredGraph}
          nodeLabel={() => ""}
          nodeVal={(node: object) => {
            const typedNode = node as ForceNode;
            return nodeRadius(typedNode) + (annotations[typedNode.id] ? 2 : 0);
          }}
          nodeColor={(node: object) => {
            const typedNode = node as ForceNode;

            let color: string;
            // F5: Incident trace highlight takes priority
            if (incidentPath.failNode === typedNode.id) {
              color = "#ff0000";
            } else if (incidentPath.nodes.has(typedNode.id)) {
              color = "#ef4444";
            } else if (typedNode.id === selectedNodeId) {
              color = "#f59e0b";
            } else if (neighborSet.has(typedNode.id)) {
              color = "#22d3ee";
            } else if (nodeMatchesTrace(typedNode, traceTokens)) {
              color = "#a3e635";
            } else {
              const health = pipelineNodeHealth(typedNode, effectiveLiveData);
              color = health ? HEALTH_COLORS[health] : nodeColor(typedNode);
              // F8: Annotated nodes get gold tint
              if (annotations[typedNode.id] && !tacticalMode) {
                color = "#f59e0b";
              }
            }

            // F7: Tactical mode — remap to green spectrum
            if (tacticalMode && !incidentPath.nodes.has(typedNode.id)) {
              color = color.startsWith("#ef") || color.startsWith("#f9") ? "#00aa2a"
                : color.startsWith("#22") || color.startsWith("#14") ? "#00ff41"
                : color.startsWith("#25") || color.startsWith("#0e") ? "#00cc33"
                : color.startsWith("#64") ? "#005500"
                : color.startsWith("#a3") ? "#00ff41"
                : "#00dd33";
            }

            if (hoveredNode && typedNode.id !== hoveredNode.id && !hoveredNeighborSet.has(typedNode.id)) {
              return color + "33";
            }
            return color;
          }}
          linkColor={(link: object) => {
            const typedLink = link as ForceLink;
            const { sourceId, targetId } = edgeEndpoints(typedLink);

            // F5: Incident trace — red edges
            if (incidentPath.nodes.has(sourceId) && incidentPath.nodes.has(targetId)) {
              return "#ef4444";
            }

            // F12: Latency overlay
            if (latencyOverlay && typedLink.layer === "pipeline") {
              const key = `${sourceId}→${targetId}`;
              const latency = latencyMap.get(key);
              if (latency !== undefined) {
                if (latency < 50) return "#22c55e";
                if (latency < 200) return "#f59e0b";
                return "#ef4444";
              }
            }

            let color: string;
            if (sourceId === selectedNodeId || targetId === selectedNodeId) {
              color = "#38bdf8";
            } else if (typedLink.layer === "pipeline") {
              color = pipelineThroughput > 10 ? "#38bdf8" : "#0ea5e9";
            } else if (typedLink.edgeType === "call_relationship") {
              color = "#f97316";
            } else {
              color = "#64748b";
            }

            if (hoveredNode) {
              const isConnected = sourceId === hoveredNode.id || targetId === hoveredNode.id;
              if (!isConnected) return color + "22";
            }
            return color;
          }}
          linkOpacity={0.58}
          linkDirectionalParticles={(link: object) => {
            const typedLink = link as ForceLink;
            if (typedLink.layer === "pipeline") {
              return 2;
            }
            return typedLink.edgeType === "call_relationship" ? 1 : 0;
          }}
          linkDirectionalParticleWidth={1.6}
          linkDirectionalParticleSpeed={(link: object) => {
            const typedLink = link as ForceLink;
            if (typedLink.layer === "pipeline" && pipelineThroughput > 0) {
              return 0.004 + Math.min(pipelineThroughput / 100, 1) * 0.012;
            }
            return 0.004;
          }}
          linkWidth={(link: object) => {
            const typedLink = link as ForceLink;
            // F12: Latency-scaled width
            if (latencyOverlay && typedLink.layer === "pipeline") {
              const { sourceId, targetId } = edgeEndpoints(typedLink);
              const latency = latencyMap.get(`${sourceId}→${targetId}`);
              if (latency !== undefined) {
                return 1 + Math.min(latency / 100, 1) * 5;
              }
            }
            if (typedLink.layer === "pipeline" && pipelineThroughput > 0) {
              return 1 + Math.min(pipelineThroughput / 20, 1) * 4;
            }
            return 1;
          }}
          backgroundColor={tacticalMode ? "#000000" : "#020617"}
          onNodeClick={(node: object, event: MouseEvent) => {
            const typedNode = node as ForceNode;
            focusNodeInGraph(typedNode.id);
          }}
          onNodeRightClick={(node: object, event: MouseEvent) => {
            event.preventDefault();
            const typedNode = node as ForceNode;
            setAnnotationTarget({
              nodeId: typedNode.id,
              label: typedNode.label,
              pos: { x: event.clientX, y: event.clientY },
            });
          }}
          onNodeHover={(node: object | null) => {
            setHoveredNode(node ? (node as ForceNode) : null);
          }}
        />
      </div>

      {/* Floating toolbar */}
      <div className="toolbar-row">
        <div className="preset-group">
          {PRESET_NAMES.map((preset) => (
            <button
              key={preset}
              type="button"
              className={activePreset === preset ? "preset active" : "preset"}
              onClick={() => applyPreset(preset)}
            >
              {preset}
            </button>
          ))}
        </div>

        <div className="export-group">
          <button
            type="button"
            className={`autorotate-btn${tacticalMode ? " active" : ""}`}
            onClick={() => setTacticalMode((prev) => !prev)}
            title="Tactical Mode (T)"
          >
            Tactical
          </button>
          <button
            type="button"
            className={`autorotate-btn${vitalsVisible ? " active" : ""}`}
            onClick={() => setVitalsVisible((prev) => !prev)}
            title="System Vitals (V)"
          >
            Vitals
          </button>
          <button
            type="button"
            className={`autorotate-btn${audioEnabled ? " active" : ""}`}
            onClick={() => setAudioEnabled((prev) => !prev)}
            title="Audio Alerts (A)"
          >
            {audioEnabled ? "Mute" : "Audio"}
          </button>
          <button
            type="button"
            className={`autorotate-btn${voiceEnabled ? " active" : ""}`}
            onClick={() => setVoiceEnabled((prev) => !prev)}
            onContextMenu={(e) => { e.preventDefault(); setVoiceVerbosity((prev) => prev === "critical" ? "all" : "critical"); }}
            title={`CAPCOM Voice (C) · ${voiceVerbosity}`}
          >
            CAPCOM
          </button>
          <button
            type="button"
            className={`autorotate-btn${latencyOverlay ? " active" : ""}`}
            onClick={() => setLatencyOverlay((prev) => !prev)}
            title="Latency Overlay (L)"
          >
            Latency
          </button>
          <button
            type="button"
            className={`autorotate-btn${recording ? " active recording-btn" : ""}`}
            onClick={() => recording ? stopRecording() : startRecording()}
            title="Session Recording (Shift+R)"
          >
            {recording ? "⏺ Rec" : "Record"}
          </button>
          <button
            type="button"
            className={`autorotate-btn${autoRotate ? " active" : ""}`}
            onClick={() => setAutoRotate((prev) => !prev)}
            title="Auto-rotate (Space)"
          >
            {autoRotate ? "Stop" : "Rotate"}
          </button>
          <button
            type="button"
            className="fullscreen-btn"
            onClick={toggleFullscreen}
            title="Fullscreen (F)"
          >
            {isFullscreen ? "Exit FS" : "Fullscreen"}
          </button>
          <ReadinessIndicator onClick={() => setPreflightOpen(true)} />
          <button type="button" className="export" onClick={() => setPreflightOpen(true)}>
            Pre-flight
          </button>
          <button type="button" className="export" onClick={() => void exportPng()}>
            PNG
          </button>
          <button type="button" className="export" onClick={() => void exportSvg()}>
            SVG
          </button>
          <button type="button" className="export" onClick={() => void exportPdf()}>
            PDF
          </button>
        </div>
      </div>

      {/* Onboarding banner */}
      {showOnboarding && (
        <div className="onboarding-banner">
          <span>
            Interactive 3D architecture map. Drag to rotate, scroll to zoom, right-click to pan.
            Press <kbd>F</kbd> for fullscreen, <kbd>Space</kbd> for auto-rotate, <kbd>R</kbd> to reset camera.
          </span>
          <button
            type="button"
            className="onboarding-dismiss"
            onClick={() => {
              setShowOnboarding(false);
              localStorage.setItem("atlas-onboarding-dismissed", "1");
            }}
          >
            Got it
          </button>
        </div>
      )}

      {/* F4: Vitals HUD */}
      <VitalsHUD liveData={effectiveLiveData} visible={vitalsVisible} />

      {/* F5: Incident trace banner */}
      {incidentTraceIntentId && (
        <div className="incident-trace-banner">
          <span>Tracing: {incidentTraceIntentId.slice(0, 12)}...</span>
          <button
            type="button"
            className="incident-trace-clear"
            onClick={() => setIncidentTraceIntentId(null)}
          >
            Clear
          </button>
        </div>
      )}

      {/* Floating overlays */}
      {legendVisible && (
        <div className="legend-overlay">
          <h4>
            Legend
            <button type="button" className="legend-toggle-btn" onClick={() => setLegendVisible(false)}>
              ✕
            </button>
          </h4>
          <div className="legend-section">
            <div className="legend-section-title">Node Types</div>
            <div className="legend-item"><span className="legend-swatch" style={{ background: "#2563eb" }} /> Crate (workspace)</div>
            <div className="legend-item"><span className="legend-swatch" style={{ background: "#64748b" }} /> Crate (external)</div>
            <div className="legend-item"><span className="legend-swatch" style={{ background: "#14b8a6" }} /> Module</div>
            <div className="legend-item"><span className="legend-swatch" style={{ background: "#f97316" }} /> Function</div>
          </div>
          <div className="legend-section">
            <div className="legend-section-title">Layers</div>
            <div className="legend-item"><span className="legend-swatch" style={{ background: "#0ea5e9" }} /> Pipeline</div>
            <div className="legend-item"><span className="legend-swatch" style={{ background: "#ef4444" }} /> Engine Internals</div>
          </div>
          <div className="legend-section">
            <div className="legend-section-title">Highlights</div>
            <div className="legend-item"><span className="legend-swatch" style={{ background: "#f59e0b" }} /> Selected</div>
            <div className="legend-item"><span className="legend-swatch" style={{ background: "#22d3ee" }} /> Neighbor</div>
            <div className="legend-item"><span className="legend-swatch" style={{ background: "#a3e635" }} /> Trace match</div>
          </div>
          <div className="legend-section">
            <div className="legend-section-title">Size</div>
            <div className="legend-item" style={{ fontSize: "0.72rem", color: "var(--text-soft)" }}>
              Larger = crate, medium = module, smaller = function
            </div>
          </div>
        </div>
      )}

      {!legendVisible && (
        <button
          type="button"
          className="legend-toggle-btn"
          style={{ position: "fixed", bottom: 52, left: 344, zIndex: 15, background: "var(--panel)", borderRadius: 8, padding: "4px 8px", border: "1px solid var(--panel-border)" }}
          onClick={() => setLegendVisible(true)}
        >
          Legend
        </button>
      )}

      {effectiveLiveData?.status === "ok" && effectiveLiveData.capital.total_balance > 0 && (
        <div className="capital-gauge-overlay">
          <CapitalGauge capital={effectiveLiveData.capital} />
        </div>
      )}

      {effectiveLiveData?.status === "ok" && (
        <div className={`operating-mode-indicator ${
          effectiveLiveData.authority.kill_switch_active ? "mode-kill" :
          effectiveLiveData.authority.safe_mode_enabled ? "mode-safe" : "mode-live"
        }`}>
          {effectiveLiveData.authority.kill_switch_active ? (
            <span>KILL SWITCH ACTIVE</span>
          ) : effectiveLiveData.authority.safe_mode_enabled ? (
            <span>SAFE MODE: {effectiveLiveData.authority.safe_mode_reason ?? "unknown"}</span>
          ) : (
            <span>{timeTravel.mode === "replay" ? "REPLAY" : "RUNNING"}</span>
          )}
        </div>
      )}

      {hoveredNode && (
        <div
          className="node-tooltip"
          style={{ left: hoverPos.x + 14, top: hoverPos.y + 14 }}
        >
          <div className="tooltip-label">{hoveredNode.label}</div>
          <div className="tooltip-row">
            <span className="tooltip-badge" style={{ background: nodeColor(hoveredNode) }}>
              {hoveredNode.nodeType}
            </span>
            <span style={{ color: "var(--text-soft)" }}>{hoveredNode.layer}</span>
          </div>
          {hoveredNode.crate && (
            <div className="tooltip-row" style={{ color: "var(--text-soft)" }}>
              Crate: {hoveredNode.crate}
            </div>
          )}
          <div className="tooltip-row" style={{ color: "var(--text-soft)" }}>
            Connections: {depCounts.get(hoveredNode.id) ?? 0}
          </div>
          {annotations[hoveredNode.id] && (
            <div className="tooltip-annotation">{annotations[hoveredNode.id]}</div>
          )}
          <div className="tooltip-hint">Click to inspect · Right-click to annotate</div>
        </div>
      )}

      {/* Fixed status bar at bottom */}
      <SystemStatusBar
        data={effectiveLiveData}
        isLive={isLive && timeTravel.mode === "live"}
        lastUpdated={liveLastUpdated}
        nodeCount={filteredGraph.nodes.length}
        edgeCount={filteredGraph.links.length}
        layerCount={enabledLayers.size}
        totalLayers={ALL_LAYERS.length}
        focusMode={focusMode}
        activePreset={activePreset}
        traceStatus={traceStatusText}
        exportStatus={exportStatus}
      />

      {/* Floating panels */}
      <aside className={`panel panel-left${leftPanelOpen ? "" : " collapsed"}`}>
        {leftPanelOpen ? (
          <>
            <div className="panel-header-row">
              <h1>Execution Architecture Atlas</h1>
              <button type="button" className="panel-toggle" onClick={() => setLeftPanelOpen(false)} title="Collapse panel">
                ‹
              </button>
            </div>
            <p className="panel-subtitle">
              Interactive map for workspace architecture, module topology, and execution pipeline.
            </p>

            <label className="control-label" htmlFor="search">
              Search crate/module
            </label>
            <input
              id="search"
              className="input"
              placeholder="execution_engine, risk_engine::..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />

            <div className="search-results">
              {searchResults.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  className="text-button"
                  onClick={() => focusNodeInGraph(node.id)}
                >
                  {node.label}
                  <span>{node.layer}</span>
                </button>
              ))}
            </div>

            <div className="toggle-row">
              <label>
                <input
                  type="checkbox"
                  checked={workspaceOnly}
                  onChange={(event) => setWorkspaceOnly(event.target.checked)}
                />
                Workspace only
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={includeExternal}
                  onChange={(event) => setIncludeExternal(event.target.checked)}
                />
                Include external crates
              </label>
            </div>

            <div className="toggle-row">
              <label>
                <input
                  type="checkbox"
                  checked={focusMode}
                  onChange={(event) => setFocusMode(event.target.checked)}
                />
                Focus mode
              </label>
            </div>

            <label className="control-label" htmlFor="depth">
              Dependency depth: {focusDepth}
            </label>
            <input
              id="depth"
              className="range"
              type="range"
              min={1}
              max={6}
              value={focusDepth}
              onChange={(event) => setFocusDepth(Number.parseInt(event.target.value, 10))}
            />

            <div className="layers">
              {ALL_LAYERS.map((layer) => (
                <button
                  key={layer}
                  type="button"
                  className={enabledLayers.has(layer) ? "layer-chip active" : "layer-chip"}
                  onClick={() => toggleLayer(layer)}
                >
                  {layer}
                </button>
              ))}
            </div>

            <button type="button" className="secondary" onClick={() => void refreshTraces()}>
              Refresh Trace Overlay
            </button>
            <div className="trace-status">{traceStatusText || "No runtime traces detected"}</div>
          </>
        ) : (
          <button type="button" className="panel-toggle" onClick={() => setLeftPanelOpen(true)} title="Expand panel">
            ›
          </button>
        )}
      </aside>

      <aside className={`panel panel-right${rightPanelOpen ? "" : " collapsed"}`}>
        {rightPanelOpen ? (
          <>
            <div className="panel-header-row">
              <div className="right-tab-bar">
                <button type="button" className={`tab-btn ${rightTab === "inspector" ? "active" : ""}`} onClick={() => setRightTab("inspector")}>Inspector</button>
                <button type="button" className={`tab-btn ${rightTab === "state_machines" ? "active" : ""}`} onClick={() => setRightTab("state_machines")}>States</button>
                <button type="button" className={`tab-btn ${rightTab === "positions" ? "active" : ""}`} onClick={() => setRightTab("positions")}>Positions</button>
                <button type="button" className={`tab-btn ${rightTab === "events" ? "active" : ""}`} onClick={() => setRightTab("events")}>Events</button>
                <button type="button" className={`tab-btn ${rightTab === "alerts" ? "active" : ""}`} onClick={() => setRightTab("alerts")}>Alerts</button>
              </div>
              <button type="button" className="panel-toggle" onClick={() => setRightPanelOpen(false)} title="Collapse panel">
                ›
              </button>
            </div>

            {rightTab === "inspector" && (
              <>
                {!selectedNode ? (
                  <p>Select a node to inspect dependencies and source location.</p>
                ) : (
                  <>
                    <div className="meta-block">
                      <strong>{selectedNode.label}</strong>
                      <span>{selectedNode.id}</span>
                    </div>
                    <div className="meta-block">
                      <span>Type: {selectedNode.nodeType}</span>
                      <span>Layer: {selectedNode.layer}</span>
                      {selectedNode.crate ? <span>Crate: {selectedNode.crate}</span> : null}
                    </div>
                    <div className="meta-block">
                      <span>Dependencies: {dependencyIds.length}</span>
                      <span>Reverse dependencies: {reverseDependencyIds.length}</span>
                    </div>
                    <div className="meta-block">
                      <span>Source location:</span>
                      {selectedNode.sourceLocation ? (
                        <code>
                          {selectedNode.sourceLocation.path}
                          {selectedNode.sourceLocation.line
                            ? `:${selectedNode.sourceLocation.line}`
                            : ""}
                        </code>
                      ) : (
                        <code>N/A</code>
                      )}
                    </div>
                    <div className="list-block">
                      <h3>Dependencies</h3>
                      {dependencyIds.length === 0 ? <p>None</p> : null}
                      {dependencyIds.map((id) => (
                        <button
                          key={`dep-${id}`}
                          type="button"
                          className="text-button"
                          onClick={() => focusNodeInGraph(id)}
                        >
                          {graphNodeMap.get(id)?.label ?? id}
                        </button>
                      ))}
                    </div>
                    <div className="list-block">
                      <h3>Reverse Dependencies</h3>
                      {reverseDependencyIds.length === 0 ? <p>None</p> : null}
                      {reverseDependencyIds.map((id) => (
                        <button
                          key={`rdep-${id}`}
                          type="button"
                          className="text-button"
                          onClick={() => focusNodeInGraph(id)}
                        >
                          {graphNodeMap.get(id)?.label ?? id}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}

            {rightTab === "state_machines" && (
              <StateMachinePanel liveData={effectiveLiveData} />
            )}

            {rightTab === "positions" && (
              <>
                {effectiveLiveData?.status === "ok" ? (
                  <>
                    <PositionsSummaryPanel positions={effectiveLiveData.positions} />
                    <FundsTimeline />
                  </>
                ) : (
                  <p style={{ color: "var(--text-soft)", fontSize: "0.84rem" }}>
                    Live data unavailable — connect to runtime database
                  </p>
                )}
              </>
            )}

            {rightTab === "events" && (
              <EventTimeline
                events={events}
                onDlqClick={(intentId) => {
                  setIncidentTraceIntentId(intentId);
                }}
              />
            )}

            {rightTab === "alerts" && (
              <AlertRulesPanel
                rules={alertRules}
                onRulesChange={setAlertRules}
                firedRules={firedRules}
              />
            )}
          </>
        ) : (
          <button type="button" className="panel-toggle" onClick={() => setRightPanelOpen(true)} title="Expand panel">
            ‹
          </button>
        )}
      </aside>

      {preflightOpen && (
        <PreflightPanel onClose={() => setPreflightOpen(false)} />
      )}

      {/* F8: Annotation Editor */}
      {annotationTarget && (
        <AnnotationEditor
          nodeId={annotationTarget.nodeId}
          nodeLabel={annotationTarget.label}
          initialText={annotations[annotationTarget.nodeId] ?? ""}
          position={annotationTarget.pos}
          onSave={(id, text) => setAnnotations((prev) => ({ ...prev, [id]: text }))}
          onDelete={(id) => setAnnotations((prev) => { const next = { ...prev }; delete next[id]; return next; })}
          onClose={() => setAnnotationTarget(null)}
        />
      )}

      {/* F9: Command Palette */}
      {commandPaletteOpen && (
        <CommandPalette
          commands={paletteCommands}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}

      {/* F13: Session Playback */}
      {sessionPlaybackOpen && (
        <SessionPlayback
          snapshots={snapshots}
          onClear={clearSnapshots}
          onClose={() => setSessionPlaybackOpen(false)}
        />
      )}
      {snapshots.length > 0 && !sessionPlaybackOpen && (
        <button
          type="button"
          className="session-open-btn"
          onClick={() => setSessionPlaybackOpen(true)}
        >
          Playback ({snapshots.length})
        </button>
      )}

      {/* F15: Timeline Scrubber */}
      {timeTravel.timeRange && (
        <TimelineScrubber
          mode={timeTravel.mode}
          replayTs={timeTravel.replayTs}
          earliestMs={timeTravel.timeRange.earliest_ms}
          latestMs={timeTravel.timeRange.latest_ms}
          onScrub={timeTravel.setReplayTs}
          onGoLive={timeTravel.goLive}
          loading={timeTravel.loading}
        />
      )}

      {/* F15: Replay mode badge */}
      {timeTravel.mode === "replay" && (
        <div className="replay-badge">
          REPLAY MODE: {new Date(timeTravel.replayTs).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

export default App;
