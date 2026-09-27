import fs from "node:fs";
import path from "node:path";

import {
  getWorkspacePackages,
  listRustFiles,
  pickPrimarySrcRoot,
  readCargoMetadata,
  resolveWorkspacePath,
} from "./cargo.js";
import {
  DATA_DIR,
  DEFAULT_WORKSPACE,
  FALLBACK_WORKSPACE,
  FRONTEND_GRAPH_PATH,
  FRONTEND_PUBLIC_DATA_DIR,
  GRAPH_PATH,
} from "./paths.js";
import { extractCallPairs, parseRustFile } from "./rustParser.js";
import type { AtlasEdge, AtlasGraph, AtlasNode, AtlasNodeType } from "./types.js";

interface CliOptions {
  workspacePath: string;
  outputPath: string;
}

function parseCliArgs(argv: string[]): CliOptions {
  const args = [...argv];
  let workspacePath = DEFAULT_WORKSPACE;
  let outputPath = GRAPH_PATH;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];

    if ((arg === "--workspace" || arg === "-w") && next) {
      workspacePath = path.resolve(next);
      i += 1;
      continue;
    }

    if ((arg === "--output" || arg === "-o") && next) {
      outputPath = path.resolve(next);
      i += 1;
    }
  }

  return { workspacePath, outputPath };
}

function ensureDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function lastSegment(pathValue: string): string {
  const parts = pathValue.split("::");
  return parts[parts.length - 1] ?? pathValue;
}

function makeNodeId(nodeType: AtlasNodeType, value: string): string {
  return `${nodeType}:${value}`;
}

function normalizePathForNode(pathValue: string): string {
  return pathValue.replace(/^crate::/, "");
}

function upsertNode(nodeMap: Map<string, AtlasNode>, node: AtlasNode): void {
  const existing = nodeMap.get(node.id);
  if (!existing) {
    nodeMap.set(node.id, node);
    return;
  }

  if (!existing.sourceLocation && node.sourceLocation) {
    existing.sourceLocation = node.sourceLocation;
  }

  if (!existing.subtype && node.subtype) {
    existing.subtype = node.subtype;
  }

  if (node.tags && node.tags.length > 0) {
    const mergedTags = new Set([...(existing.tags ?? []), ...node.tags]);
    existing.tags = [...mergedTags];
  }
}

function upsertEdge(edgeMap: Map<string, AtlasEdge>, edge: AtlasEdge): void {
  if (!edgeMap.has(edge.id)) {
    edgeMap.set(edge.id, edge);
  }
}

function createPipelineNodesAndEdges(
  nodeMap: Map<string, AtlasNode>,
  edgeMap: Map<string, AtlasEdge>,
  crateNames: Set<string>,
): void {
  const pipeline = [
    "market_data",
    "strategy",
    "risk_engine",
    "intent_queue",
    "execution_engine",
    "polymarket_adapter",
  ];

  const stageToCrate: Record<string, string | undefined> = {
    market_data: crateNames.has("market_registry") ? "market_registry" : undefined,
    strategy: crateNames.has("strategy") ? "strategy" : undefined,
    risk_engine: crateNames.has("risk_engine") ? "risk_engine" : undefined,
    intent_queue: crateNames.has("intent_queue") ? "intent_queue" : undefined,
    execution_engine: crateNames.has("execution_engine")
      ? "execution_engine"
      : undefined,
    polymarket_adapter: crateNames.has("execution_tool") ? "execution_tool" : undefined,
  };

  for (let i = 0; i < pipeline.length; i += 1) {
    const stage = pipeline[i] as string;
    const stageId = makeNodeId("module", `pipeline::${stage}`);

    upsertNode(nodeMap, {
      id: stageId,
      label: stage,
      nodeType: "module",
      layer: "pipeline",
      subtype: "pipeline_stage",
      tags: ["pipeline"],
    });

    if (i < pipeline.length - 1) {
      const targetStage = pipeline[i + 1] as string;
      upsertEdge(edgeMap, {
        id: `edge:${stageId}->${makeNodeId("module", `pipeline::${targetStage}`)}:pipeline`,
        source: stageId,
        target: makeNodeId("module", `pipeline::${targetStage}`),
        edgeType: "module_dependency",
        layer: "pipeline",
        tags: ["pipeline"],
      });
    }

    const mappedCrate = stageToCrate[stage];
    if (mappedCrate) {
      upsertEdge(edgeMap, {
        id: `edge:${stageId}->${makeNodeId("crate", mappedCrate)}:pipeline_binding`,
        source: stageId,
        target: makeNodeId("crate", mappedCrate),
        edgeType: "module_dependency",
        layer: "pipeline",
        tags: ["pipeline", "binding"],
      });
    }
  }
}

function createEngineInternalLayer(
  nodeMap: Map<string, AtlasNode>,
  edgeMap: Map<string, AtlasEdge>,
): void {
  const engineComponents: Array<{ key: string; label: string }> = [
    { key: "authority", label: "authority" },
    { key: "coordinator", label: "coordinator" },
    { key: "retry_policy", label: "retry policy" },
    { key: "dead_letter_queue", label: "dead letter queue" },
    { key: "adapter_boundary", label: "adapter boundary" },
  ];

  for (const component of engineComponents) {
    const nodeId = makeNodeId("module", `execution_engine::internal::${component.key}`);
    const concreteModuleId = makeNodeId("module", `execution_engine::${component.key}`);
    const concreteModule = nodeMap.get(concreteModuleId);

    upsertNode(nodeMap, {
      id: nodeId,
      label: component.label,
      nodeType: "module",
      layer: "engine_internals",
      crate: "execution_engine",
      modulePath: `execution_engine::internal::${component.key}`,
      subtype: "engine_component",
      tags: ["engine_internals"],
      sourceLocation: concreteModule?.sourceLocation,
    });

    if (concreteModule) {
      upsertEdge(edgeMap, {
        id: `edge:${nodeId}->${concreteModuleId}:engine_internal_binding`,
        source: nodeId,
        target: concreteModuleId,
        edgeType: "module_dependency",
        layer: "engine_internals",
        tags: ["engine_internals", "binding"],
      });
    }
  }

  const chain: Array<[string, string]> = [
    ["authority", "coordinator"],
    ["coordinator", "retry_policy"],
    ["retry_policy", "dead_letter_queue"],
    ["coordinator", "adapter_boundary"],
  ];

  for (const [sourceKey, targetKey] of chain) {
    const sourceId = makeNodeId("module", `execution_engine::internal::${sourceKey}`);
    const targetId = makeNodeId("module", `execution_engine::internal::${targetKey}`);

    upsertEdge(edgeMap, {
      id: `edge:${sourceId}->${targetId}:engine_flow`,
      source: sourceId,
      target: targetId,
      edgeType: "module_dependency",
      layer: "engine_internals",
      tags: ["engine_internals", "flow"],
    });
  }

  const executionPipelineNode = makeNodeId("module", "pipeline::execution_engine");
  const authorityNode = makeNodeId("module", "execution_engine::internal::authority");

  upsertEdge(edgeMap, {
    id: `edge:${executionPipelineNode}->${authorityNode}:pipeline_to_engine_internal`,
    source: executionPipelineNode,
    target: authorityNode,
    edgeType: "module_dependency",
    layer: "engine_internals",
    tags: ["pipeline", "engine_internals"],
  });
}

function writeGraph(outputPath: string, graph: AtlasGraph): void {
  ensureDirectory(path.dirname(outputPath));
  fs.writeFileSync(outputPath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");

  ensureDirectory(DATA_DIR);
  fs.writeFileSync(GRAPH_PATH, `${JSON.stringify(graph, null, 2)}\n`, "utf8");

  ensureDirectory(FRONTEND_PUBLIC_DATA_DIR);
  fs.writeFileSync(FRONTEND_GRAPH_PATH, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
}

function main(): void {
  const options = parseCliArgs(process.argv.slice(2));
  const workspacePath = resolveWorkspacePath(options.workspacePath, FALLBACK_WORKSPACE);

  if (!fs.existsSync(workspacePath)) {
    throw new Error(
      `Workspace not found at ${workspacePath}. Use --workspace to set the Rust workspace path.`,
    );
  }

  const metadata = readCargoMetadata(workspacePath);
  const workspacePackages = getWorkspacePackages(metadata);
  const workspaceCrateNames = new Set(workspacePackages.map((pkg) => pkg.name));

  const nodeMap = new Map<string, AtlasNode>();
  const edgeMap = new Map<string, AtlasEdge>();

  for (const pkg of workspacePackages) {
    const crateNodeId = makeNodeId("crate", pkg.name);
    const srcRoot = pickPrimarySrcRoot(pkg);
    const srcPath = srcRoot ? path.join(srcRoot, "lib.rs") : undefined;

    upsertNode(nodeMap, {
      id: crateNodeId,
      label: pkg.name,
      nodeType: "crate",
      layer: "workspace",
      crate: pkg.name,
      modulePath: pkg.name,
      external: false,
      sourceLocation: srcPath && fs.existsSync(srcPath) ? { path: srcPath } : undefined,
    });
  }

  for (const pkg of workspacePackages) {
    const sourceCrateId = makeNodeId("crate", pkg.name);

    for (const dependency of pkg.dependencies) {
      const dependencyName = dependency.name;
      const targetCrateId = makeNodeId("crate", dependencyName);
      const isExternal = !workspaceCrateNames.has(dependencyName);

      if (isExternal) {
        upsertNode(nodeMap, {
          id: targetCrateId,
          label: dependencyName,
          nodeType: "crate",
          layer: "workspace",
          crate: dependencyName,
          modulePath: dependencyName,
          external: true,
          subtype: "external_crate",
          tags: ["external"],
        });
      }

      upsertEdge(edgeMap, {
        id: `edge:${sourceCrateId}->${targetCrateId}:crate_dependency`,
        source: sourceCrateId,
        target: targetCrateId,
        edgeType: "crate_dependency",
        layer: "workspace",
      });
    }
  }

  for (const pkg of workspacePackages) {
    const srcRoot = pickPrimarySrcRoot(pkg);
    if (!srcRoot) {
      continue;
    }

    const rustFiles = listRustFiles(srcRoot);

    for (const rustFile of rustFiles) {
      const parsed = parseRustFile(
        rustFile,
        pkg.name,
        srcRoot,
        workspaceCrateNames,
      );

      const sourceModulePath = normalizePathForNode(parsed.modulePath);
      const sourceModuleId = makeNodeId("module", sourceModulePath);

      upsertNode(nodeMap, {
        id: sourceModuleId,
        label: lastSegment(sourceModulePath),
        nodeType: "module",
        layer: "module",
        crate: pkg.name,
        modulePath: sourceModulePath,
        sourceLocation: { path: rustFile, line: 1 },
      });

      for (const dependencyPath of parsed.moduleDependencies) {
        const normalizedDependencyPath = normalizePathForNode(dependencyPath);
        const dependencyCrate = normalizedDependencyPath.split("::")[0] ?? "";
        if (!workspaceCrateNames.has(dependencyCrate)) {
          continue;
        }

        const targetModuleId = makeNodeId("module", normalizedDependencyPath);
        upsertNode(nodeMap, {
          id: targetModuleId,
          label: lastSegment(normalizedDependencyPath),
          nodeType: "module",
          layer: "module",
          crate: dependencyCrate,
          modulePath: normalizedDependencyPath,
        });

        upsertEdge(edgeMap, {
          id: `edge:${sourceModuleId}->${targetModuleId}:module_dependency`,
          source: sourceModuleId,
          target: targetModuleId,
          edgeType: "module_dependency",
          layer: "module",
        });
      }

      for (const rustFunction of parsed.functions) {
        const functionPath = `${sourceModulePath}::${rustFunction.name}`;
        const functionNodeId = makeNodeId("function", functionPath);

        upsertNode(nodeMap, {
          id: functionNodeId,
          label: rustFunction.name,
          nodeType: "function",
          layer: "module",
          crate: pkg.name,
          modulePath: sourceModulePath,
          sourceLocation: {
            path: rustFile,
            line: rustFunction.line,
            column: 1,
          },
        });

        upsertEdge(edgeMap, {
          id: `edge:${sourceModuleId}->${functionNodeId}:module_to_function`,
          source: sourceModuleId,
          target: functionNodeId,
          edgeType: "module_dependency",
          layer: "module",
        });
      }

      const callPairs = extractCallPairs(parsed.functions);
      for (const [sourceFunction, targetFunction] of callPairs) {
        const sourceFunctionId = makeNodeId(
          "function",
          `${sourceModulePath}::${sourceFunction}`,
        );
        const targetFunctionId = makeNodeId(
          "function",
          `${sourceModulePath}::${targetFunction}`,
        );

        upsertEdge(edgeMap, {
          id: `edge:${sourceFunctionId}->${targetFunctionId}:call_relationship`,
          source: sourceFunctionId,
          target: targetFunctionId,
          edgeType: "call_relationship",
          layer: "module",
        });
      }
    }
  }

  createPipelineNodesAndEdges(nodeMap, edgeMap, workspaceCrateNames);
  createEngineInternalLayer(nodeMap, edgeMap);

  const graph: AtlasGraph = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    workspacePath,
    layers: ["workspace", "module", "pipeline", "engine_internals"],
    nodes: [...nodeMap.values()],
    edges: [...edgeMap.values()],
  };

  writeGraph(options.outputPath, graph);

  const summary = {
    workspacePath,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    outputPath: options.outputPath,
    mirroredDataPath: GRAPH_PATH,
    mirroredFrontendPath: FRONTEND_GRAPH_PATH,
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main();
