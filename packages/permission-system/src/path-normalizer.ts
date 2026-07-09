import { posix as posixPath, win32 as winPath } from "node:path";

import { AccessPath } from "./access-intent/access-path.ts";
import { classifyWin32BashToken } from "./access-intent/bash/msys-bash-tokens.ts";
import {
  canonicalNormalizePathForComparison,
  normalizePathForComparison,
  normalizePathPolicyLiteral,
} from "./access-intent/path-normalization.ts";
import { isPathOutsideWorkingDirectory, isPathWithinDirectory } from "./path-containment.ts";

export type BashCdTarget =
  | { readonly kind: "absolute"; readonly value: string }
  | { readonly kind: "relative" }
  | { readonly kind: "unknown" };

export class PathNormalizer {
  private readonly impl: typeof posixPath;
  private readonly canonicalCwd: string;

  constructor(
    private readonly platform: NodeJS.Platform,
    private readonly cwd: string,
  ) {
    this.impl = platform === "win32" ? winPath : posixPath;
    this.canonicalCwd = canonicalNormalizePathForComparison(cwd, cwd, platform);
  }

  forPath(pathValue: string, options?: { resolveBase?: string }): AccessPath {
    return AccessPath.forPath(pathValue, {
      cwd: this.cwd,
      resolveBase: options?.resolveBase,
      platform: this.platform,
    });
  }

  forLiteral(literal: string, matchAliases?: readonly string[]): AccessPath {
    return AccessPath.forLiteral(literal, matchAliases);
  }

  forBashToken(token: string, options?: { resolveBase?: string }): AccessPath {
    if (this.platform !== "win32") return this.forPath(token, options);

    const shape = classifyWin32BashToken(token);
    switch (shape.kind) {
      case "device":
        return AccessPath.forDevice(token);
      case "drive-mount":
        return this.forPath(shape.windowsPath, options);
      case "posix-absolute": {
        const literal = normalizePathPolicyLiteral(token);
        return this.forLiteral(literal, [literal.replaceAll("/", "\\")]);
      }
      case "plain":
        return this.forPath(token, options);
    }
  }

  isAbsolute(pathValue: string): boolean {
    return this.impl.isAbsolute(pathValue);
  }

  usesWindowsSeparators(): boolean {
    return this.platform === "win32";
  }

  interpretBashCdTarget(target: string): BashCdTarget {
    if (this.platform !== "win32") {
      return this.impl.isAbsolute(target) ? { kind: "absolute", value: target } : { kind: "relative" };
    }

    const shape = classifyWin32BashToken(target);
    switch (shape.kind) {
      case "drive-mount":
        return { kind: "absolute", value: shape.windowsPath };
      case "device":
      case "posix-absolute":
        return { kind: "unknown" };
      case "plain":
        return this.impl.isAbsolute(target) ? { kind: "absolute", value: target } : { kind: "relative" };
    }
  }

  resolveBase(offset: string): string {
    return this.impl.resolve(this.cwd, offset);
  }

  joinBase(offset: string, target: string): string {
    return this.impl.join(offset, target);
  }

  isWithinDirectory(pathValue: string, directory: string): boolean {
    return isPathWithinDirectory(pathValue, directory, this.platform);
  }

  isBoundaryOutsideWorkingDirectory(canonicalPath: string): boolean {
    return isPathOutsideWorkingDirectory(canonicalPath, this.canonicalCwd, this.platform);
  }

  comparableValue(pathValue: string): string {
    return normalizePathForComparison(pathValue, this.cwd, this.platform);
  }
}
