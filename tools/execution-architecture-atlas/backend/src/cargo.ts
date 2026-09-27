import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { CargoMetadata, CargoPackage } from "./types.js";

export function resolveWorkspacePath(preferredWorkspace: string, fallback: string): string {
  if (fs.existsSync(preferredWorkspace)) {
    return path.resolve(preferredWorkspace);
  }
  if (fs.existsSync(fallback)) {
    return path.resolve(fallback);
  }
  return path.resolve(preferredWorkspace);
}

export function readCargoMetadata(workspacePath: string): CargoMetadata {
  const result = spawnSync(
    "cargo",
    ["metadata", "--format-version", "1", "--no-deps"],
    {
      cwd: workspacePath,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 50,
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `cargo metadata failed in ${workspacePath}: ${result.stderr || result.stdout}`,
    );
  }

  return JSON.parse(result.stdout) as CargoMetadata;
}

export function getWorkspacePackages(metadata: CargoMetadata): CargoPackage[] {
  const workspaceMemberIds = new Set(metadata.workspace_members);
  return metadata.packages.filter((pkg) => workspaceMemberIds.has(pkg.id));
}

export function pickPrimarySrcRoot(pkg: CargoPackage): string | null {
  const preferredTarget =
    pkg.targets.find((target) => target.kind.includes("lib")) ||
    pkg.targets.find((target) => target.kind.includes("bin"));

  if (!preferredTarget) {
    return null;
  }

  return path.dirname(preferredTarget.src_path);
}

export function listRustFiles(dirPath: string): string[] {
  const files: string[] = [];

  const walk = (currentPath: string): void => {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (entry.isFile() && absolutePath.endsWith(".rs")) {
        files.push(absolutePath);
      }
    }
  };

  if (fs.existsSync(dirPath)) {
    walk(dirPath);
  }

  return files;
}
