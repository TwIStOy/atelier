import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export interface CanvasPage {
  name: string;
  html: string;
  updatedAt: number;
}

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const HTML_SUFFIX = ".html";

export function isValidPageName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

export function pageNameFromFile(filename: string): string | null {
  if (!filename.endsWith(HTML_SUFFIX)) return null;
  const name = filename.slice(0, -HTML_SUFFIX.length);
  return isValidPageName(name) ? name : null;
}

// Disk is the source of truth (no in-memory page cache): multiple pi sessions
// share the directory, so reads rescan to stay consistent across processes.
export class PageStore {
  private readonly writtenAt = new Map<string, number>();

  constructor(readonly dir: string) {}

  get(name: string): CanvasPage | undefined {
    if (!isValidPageName(name)) return undefined;
    const filePath = join(this.dir, `${name}${HTML_SUFFIX}`);
    try {
      const html = readFileSync(filePath, "utf8");
      return { name, html, updatedAt: statSync(filePath).mtimeMs };
    } catch {
      return undefined;
    }
  }

  list(): CanvasPage[] {
    if (!existsSync(this.dir)) return [];
    const pages: CanvasPage[] = [];
    for (const entry of readdirSync(this.dir)) {
      const name = pageNameFromFile(entry);
      if (!name) continue;
      const page = this.get(name);
      if (page) pages.push(page);
    }
    return pages.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  upsert(name: string, html: string): CanvasPage {
    mkdirSync(this.dir, { recursive: true });
    const target = join(this.dir, `${name}${HTML_SUFFIX}`);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, html, "utf8");
    renameSync(tmp, target);
    this.writtenAt.set(name, Date.now());
    return { name, html, updatedAt: Date.now() };
  }

  remove(name: string): boolean {
    const filePath = join(this.dir, `${name}${HTML_SUFFIX}`);
    let existed = false;
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        existed = true;
      }
    } catch {
      return false;
    }
    this.writtenAt.set(name, Date.now());
    return existed;
  }

  recentlyWritten(name: string, withinMs = 1000): boolean {
    const at = this.writtenAt.get(name);
    return at !== undefined && Date.now() - at < withinMs;
  }
}
