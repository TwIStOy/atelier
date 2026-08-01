import * as fs from "node:fs";
import * as path from "node:path";
import { contentHash } from "./atomic.ts";
import { type ManifestOriginFile, readManifestSafe } from "./manifest.ts";
import { vaultLayout } from "./paths.ts";

const INBOX_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".text"]);

export interface InboxFile {
  name: string;
  path: string;
  relPath: string;
}

export interface InboxScan {
  inboxDir: string;
  uncaptured: InboxFile[];
  modified: InboxFile[];
  captured: InboxFile[];
}

export interface ScanInboxOptions {
  inboxDir?: string;
}

export function scanInbox(vaultRoot: string, opts: ScanInboxOptions = {}): InboxScan {
  const layout = vaultLayout(vaultRoot);
  const inboxDir = opts.inboxDir ?? layout.inbox;
  const index = buildFileManifestIndex(layout.sourcesRoot);

  const uncaptured: InboxFile[] = [];
  const modified: InboxFile[] = [];
  const captured: InboxFile[] = [];

  if (!existsDir(inboxDir)) {
    return { inboxDir, uncaptured, modified, captured };
  }

  for (const name of fs.readdirSync(inboxDir).sort()) {
    const abs = path.join(inboxDir, name);
    if (!isRegularFile(abs)) continue;
    if (!INBOX_EXTENSIONS.has(path.extname(name).toLowerCase())) continue;

    const file: InboxFile = {
      name,
      path: abs,
      relPath: toPosix(path.relative(vaultRoot, abs)),
    };

    const hit = index.byOriginPath.get(abs);
    if (!hit) {
      uncaptured.push(file);
      continue;
    }

    let currentHash: string;
    try {
      currentHash = contentHash(fs.readFileSync(abs));
    } catch {
      continue;
    }

    if (hit.origin.originHash !== currentHash) {
      modified.push(file);
    } else {
      captured.push(file);
    }
  }

  return { inboxDir, uncaptured, modified, captured };
}

interface FileManifestIndex {
  byOriginPath: Map<string, FilePacketEntry>;
}

interface FilePacketEntry {
  dir: string;
  origin: ManifestOriginFile;
}

function buildFileManifestIndex(sourcesRoot: string): FileManifestIndex {
  const byOriginPath = new Map<string, FilePacketEntry>();
  if (!existsDir(sourcesRoot)) return { byOriginPath };
  for (const name of fs.readdirSync(sourcesRoot)) {
    if (!name.startsWith("SRC-")) continue;
    const dir = path.join(sourcesRoot, name);
    if (!isDirectory(dir)) continue;
    const manifest = readManifestSafe(dir);
    if (!manifest) continue;
    if (manifest.origin.sourceType !== "file") continue;
    byOriginPath.set(manifest.origin.originPath, { dir, origin: manifest.origin });
  }
  return { byOriginPath };
}

function existsDir(target: string): boolean {
  return fs.existsSync(target) && fs.statSync(target).isDirectory();
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function isRegularFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
