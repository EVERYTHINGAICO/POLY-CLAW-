import type {
  AtlasEdge,
  AtlasGraph,
  AtlasLayer,
  ForceLink,
  ForceNode,
  GraphData,
} from "./types";

export interface FilterOptions {
  includeExternal: boolean;
  workspaceOnly: boolean;
  enabledLayers: Set<AtlasLayer>;
  focusNodeId?: string;
  focusMode: boolean;
  focusDepth: number;
}

function edgeNodeId(value: string | ForceNode): string {
  return typeof value === "string" ? value : value.id;
}

function collectNeighborhood(
  links: ForceLink[],
  startId: string,
  depth: number,
): Set<string> {
  const adjacency = new Map<string, Set<string>>();

  for (const link of links) {
    const source = edgeNodeId(link.source);
    const target = edgeNodeId(link.target);

    if (!adjacency.has(source)) {
      adjacency.set(source, new Set<string>());
    }
    if (!adjacency.has(target)) {
      adjacency.set(target, new Set<string>());
    }

    adjacency.get(source)?.add(target);
    adjacency.get(target)?.add(source);
  }

  const visited = new Set<string>([startId]);
  const queue: Array<{ id: string; distance: number }> = [{ id: startId, distance: 0 }];

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) {
      continue;
    }

    if (item.distance >= depth) {
      continue;
    }

    for (const neighbor of adjacency.get(item.id) ?? []) {
      if (visited.has(neighbor)) {
        continue;
      }
      visited.add(neighbor);
      queue.push({ id: neighbor, distance: item.distance + 1 });
    }
  }

  return visited;
}

export function filterGraph(graph: AtlasGraph, options: FilterOptions): GraphData {
  const allowedNodes = graph.nodes.filter((node) => {
    if (options.workspaceOnly) {
      return node.layer === "workspace" && node.nodeType === "crate";
    }

    if (!options.enabledLayers.has(node.layer)) {
      return false;
    }

    if (!options.includeExternal && node.external) {
      return false;
    }

    return true;
  });

  const allowedNodeIds = new Set(allowedNodes.map((node) => node.id));

  let links: ForceLink[] = graph.edges
    .filter((edge) => {
      if (options.workspaceOnly && edge.layer !== "workspace") {
        return false;
      }

      return allowedNodeIds.has(edge.source) && allowedNodeIds.has(edge.target);
    })
    .map((edge) => ({ ...edge }));

  let nodes: ForceNode[] = allowedNodes.map((node) => ({ ...node }));

  if (options.focusMode && options.focusNodeId && allowedNodeIds.has(options.focusNodeId)) {
    const neighborhood = collectNeighborhood(links, options.focusNodeId, options.focusDepth);
    nodes = nodes.filter((node) => neighborhood.has(node.id));
    const focusedNodeIds = new Set(nodes.map((node) => node.id));
    links = links.filter(
      (edge) =>
        focusedNodeIds.has(edgeNodeId(edge.source)) &&
        focusedNodeIds.has(edgeNodeId(edge.target)),
    );
  }

  return { nodes, links };
}

export function dependenciesForNode(graph: AtlasGraph, nodeId: string): string[] {
  return graph.edges
    .filter((edge) => edge.source === nodeId)
    .map((edge) => edge.target);
}

export function reverseDependenciesForNode(graph: AtlasGraph, nodeId: string): string[] {
  return graph.edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => edge.source);
}

export function nodeMatchesTrace(node: ForceNode, highlights: Set<string>): boolean {
  if (highlights.size === 0) {
    return false;
  }

  const haystacks = [
    node.id.toLowerCase(),
    node.label.toLowerCase(),
    (node.crate ?? "").toLowerCase(),
    (node.modulePath ?? "").toLowerCase(),
  ];

  for (const highlight of highlights) {
    const token = highlight.toLowerCase();
    if (!token) {
      continue;
    }
    if (haystacks.some((value) => value.includes(token))) {
      return true;
    }
  }

  return false;
}

export function edgeEndpoints(edge: ForceLink): { sourceId: string; targetId: string } {
  return {
    sourceId: edgeNodeId(edge.source),
    targetId: edgeNodeId(edge.target),
  };
}

export function layersDefault(graph?: AtlasGraph): Set<AtlasLayer> {
  if (!graph) {
    return new Set<AtlasLayer>([
      "workspace",
      "module",
      "pipeline",
      "engine_internals",
    ]);
  }

  return new Set<AtlasLayer>(graph.layers);
}

export function nodeById(graph: AtlasGraph): Map<string, ForceNode> {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

export function linksFromEdges(edges: AtlasEdge[]): ForceLink[] {
  return edges.map((edge) => ({ ...edge }));
}

export function dependencyCountMap(graph: AtlasGraph): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of graph.edges) {
    counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
    counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
  }
  return counts;
}
