import fs from "node:fs";
import path from "node:path";

import type { ParsedRustFile, RustFunction } from "./types.js";

const MOD_DECLARATION_REGEX = /^\s*(?:pub\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/gm;
const USE_REGEX = /^\s*use\s+([^;]+);/gm;
const FUNCTION_REGEX = /\b(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

const CALL_EXCLUDE = new Set([
  "if",
  "while",
  "for",
  "loop",
  "match",
  "return",
  "Some",
  "Ok",
  "Err",
]);

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/");
}

export function deriveModulePath(
  crateName: string,
  filePath: string,
  srcRoot: string,
): string {
  const relativePath = normalizeRelativePath(path.relative(srcRoot, filePath));

  if (relativePath === "lib.rs" || relativePath === "main.rs") {
    return crateName;
  }

  if (relativePath.endsWith("/mod.rs")) {
    const directoryPath = relativePath.slice(0, -"/mod.rs".length);
    return `${crateName}::${directoryPath.split("/").join("::")}`;
  }

  const withoutExtension = relativePath.replace(/\.rs$/, "");
  return `${crateName}::${withoutExtension.split("/").join("::")}`;
}

function resolveSuperPath(modulePath: string, usePath: string): string {
  const moduleParts = modulePath.split("::");
  const useParts = usePath.split("::");

  let superDepth = 0;
  while (useParts[superDepth] === "super") {
    superDepth += 1;
  }

  const baseParts = moduleParts.slice(0, Math.max(1, moduleParts.length - superDepth));
  const remainder = useParts.slice(superDepth);
  return [...baseParts, ...remainder].join("::");
}

function cleanUsePath(rawUsePath: string): string {
  const compact = rawUsePath.replace(/\s+/g, "");
  const withoutAlias = compact.split("as")[0] ?? compact;
  return withoutAlias.replace(/::\{.*$/, "").replace(/[{}]/g, "");
}

export function extractModuleDependencies(
  content: string,
  crateName: string,
  modulePath: string,
  workspaceCrateNames: Set<string>,
): string[] {
  const dependencies = new Set<string>();

  for (const modMatch of content.matchAll(MOD_DECLARATION_REGEX)) {
    const childName = modMatch[1];
    if (!childName) {
      continue;
    }
    dependencies.add(`${modulePath}::${childName}`);
  }

  for (const useMatch of content.matchAll(USE_REGEX)) {
    const rawUsePath = useMatch[1];
    if (!rawUsePath) {
      continue;
    }

    const usePath = cleanUsePath(rawUsePath);
    if (!usePath) {
      continue;
    }

    if (usePath.startsWith("crate::")) {
      dependencies.add(`${crateName}::${usePath.replace(/^crate::/, "")}`);
      continue;
    }

    if (usePath.startsWith("self::")) {
      dependencies.add(`${modulePath}::${usePath.replace(/^self::/, "")}`);
      continue;
    }

    if (usePath.startsWith("super::")) {
      dependencies.add(resolveSuperPath(modulePath, usePath));
      continue;
    }

    const firstSegment = usePath.split("::")[0];
    if (!firstSegment) {
      continue;
    }

    if (firstSegment === crateName) {
      dependencies.add(usePath);
      continue;
    }

    if (workspaceCrateNames.has(firstSegment)) {
      dependencies.add(usePath);
    }
  }

  return [...dependencies];
}

function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function extractFunctionBody(content: string, startIndex: number): string {
  const openBraceIndex = content.indexOf("{", startIndex);
  if (openBraceIndex < 0) {
    return "";
  }

  let depth = 0;
  for (let i = openBraceIndex; i < content.length; i += 1) {
    const char = content[i];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return content.slice(openBraceIndex, i + 1);
      }
    }
  }

  return content.slice(openBraceIndex);
}

export function extractFunctions(content: string): RustFunction[] {
  const functions: RustFunction[] = [];

  for (const functionMatch of content.matchAll(FUNCTION_REGEX)) {
    const name = functionMatch[1];
    const startIndex = functionMatch.index;
    if (!name || startIndex === undefined) {
      continue;
    }

    functions.push({
      name,
      startIndex,
      line: getLineNumber(content, startIndex),
      body: extractFunctionBody(content, startIndex),
    });
  }

  return functions;
}

export function parseRustFile(
  filePath: string,
  crateName: string,
  srcRoot: string,
  workspaceCrateNames: Set<string>,
): ParsedRustFile {
  const content = fs.readFileSync(filePath, "utf8");
  const modulePath = deriveModulePath(crateName, filePath, srcRoot);

  return {
    modulePath,
    moduleDependencies: extractModuleDependencies(
      content,
      crateName,
      modulePath,
      workspaceCrateNames,
    ),
    functions: extractFunctions(content),
  };
}

export function extractCallPairs(functions: RustFunction[]): Array<[string, string]> {
  const functionNames = new Set(functions.map((fn) => fn.name));
  const pairs = new Set<string>();

  for (const sourceFunction of functions) {
    const callRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    for (const callMatch of sourceFunction.body.matchAll(callRegex)) {
      const callee = callMatch[1];
      if (!callee || CALL_EXCLUDE.has(callee)) {
        continue;
      }
      if (callee === sourceFunction.name) {
        continue;
      }
      if (!functionNames.has(callee)) {
        continue;
      }

      const key = `${sourceFunction.name}->${callee}`;
      pairs.add(key);
    }
  }

  return [...pairs].map((pair) => {
    const [source, target] = pair.split("->");
    return [source, target] as [string, string];
  });
}
