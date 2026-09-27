export type AtlasNodeType = "crate" | "module" | "function";

export type AtlasEdgeType =
  | "crate_dependency"
  | "module_dependency"
  | "call_relationship";

export type AtlasLayer =
  | "workspace"
  | "module"
  | "pipeline"
  | "engine_internals";

export interface SourceLocation {
  path: string;
  line?: number;
  column?: number;
}

export interface AtlasNode {
  id: string;
  label: string;
  nodeType: AtlasNodeType;
  layer: AtlasLayer;
  crate?: string;
  modulePath?: string;
  external?: boolean;
  subtype?: string;
  tags?: string[];
  sourceLocation?: SourceLocation;
}

export interface AtlasEdge {
  id: string;
  source: string;
  target: string;
  edgeType: AtlasEdgeType;
  layer: AtlasLayer;
  weight?: number;
  tags?: string[];
}

export interface AtlasGraph {
  schemaVersion: number;
  generatedAt: string;
  workspacePath: string;
  layers: AtlasLayer[];
  nodes: AtlasNode[];
  edges: AtlasEdge[];
}

export interface ForceNode extends AtlasNode {
  x?: number;
  y?: number;
  z?: number;
}

export type ForceLink = Omit<AtlasEdge, "source" | "target"> & {
  source: string | ForceNode;
  target: string | ForceNode;
};

export interface GraphData {
  nodes: ForceNode[];
  links: ForceLink[];
}

export interface TraceResponse {
  status: "ok" | "no_traces";
  service?: string;
  traces: unknown[];
  highlights: string[];
  message?: string;
}
