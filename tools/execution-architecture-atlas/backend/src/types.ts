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

export interface CargoDependency {
  name: string;
  path?: string | null;
  source?: string | null;
}

export interface CargoTarget {
  kind: string[];
  src_path: string;
}

export interface CargoPackage {
  id: string;
  name: string;
  dependencies: CargoDependency[];
  targets: CargoTarget[];
  manifest_path: string;
}

export interface CargoMetadata {
  packages: CargoPackage[];
  workspace_members: string[];
  workspace_root: string;
}

export interface RustFunction {
  name: string;
  startIndex: number;
  line: number;
  body: string;
}

export interface ParsedRustFile {
  modulePath: string;
  moduleDependencies: string[];
  functions: RustFunction[];
}
