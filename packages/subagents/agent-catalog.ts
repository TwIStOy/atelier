import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

const ULTIMATE_DEFAULT_PROMPT =
  "You are a focused sub-agent running inside the same Pi process. Use your tools to complete the assignment. When done, reply with a concise final summary for the parent agent.";

export type SubagentAgentFileOptions = {
  description?: string;
  model?: string;
  thinking?: string;
  inherit_context?: boolean;
  isolated?: boolean;
  max_turns?: number;
};

export type SubagentAgentEntry = {
  prompt: string;
  fileOptions: SubagentAgentFileOptions;
};

export type SubagentAgentCatalog = {
  agents: Map<string, SubagentAgentEntry>;
};

function shippedAgentsDir(): string {
  return fileURLToPath(new URL("./agents/", import.meta.url));
}

export function normalizeSubagentAgentId(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "-");
  if (!/^[a-z][a-z0-9_-]*$/.test(s)) return "";
  return s;
}

function agentIdFromFrontmatter(
  fm: Record<string, unknown>,
  defaultId: string,
): string {
  const n = fm["name"];
  if (typeof n === "string" && n.trim()) {
    const x = normalizeSubagentAgentId(n);
    if (x) return x;
  }
  if (typeof n === "number" && Number.isFinite(n)) {
    const x = normalizeSubagentAgentId(String(n));
    if (x) return x;
  }
  return defaultId;
}

function parseStringField(
  fm: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = fm[key];
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function parseBooleanField(
  fm: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const v = fm[key];
  if (typeof v === "boolean") return v;
  return undefined;
}

function parseMaxTurnsField(fm: Record<string, unknown>): number | undefined {
  const v = fm["max_turns"];
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const n = Math.floor(v);
  return n >= 1 ? n : undefined;
}

function parseFileOptionsFromFrontmatter(
  fm: Record<string, unknown>,
): SubagentAgentFileOptions {
  const descriptionRaw = parseStringField(fm, "description");
  const description =
    descriptionRaw && descriptionRaw.length > 72
      ? descriptionRaw.slice(0, 72)
      : descriptionRaw;
  const model = parseStringField(fm, "model");
  const thinking = parseStringField(fm, "thinking");
  const inherit_context = parseBooleanField(fm, "inherit_context");
  const isolated = parseBooleanField(fm, "isolated");
  const max_turns = parseMaxTurnsField(fm);
  const out: SubagentAgentFileOptions = {};
  if (description) out.description = description;
  if (model) out.model = model;
  if (thinking) out.thinking = thinking;
  if (inherit_context !== undefined) out.inherit_context = inherit_context;
  if (isolated !== undefined) out.isolated = isolated;
  if (max_turns !== undefined) out.max_turns = max_turns;
  return out;
}

function parseAgentMarkdown(
  raw: string,
  filenameBase: string,
): {
  id: string;
  prompt: string;
  fileOptions: SubagentAgentFileOptions;
} | null {
  const defaultId = normalizeSubagentAgentId(filenameBase);
  if (!defaultId) return null;
  let frontmatter: Record<string, unknown> = {};
  let body: string;
  try {
    const p = parseFrontmatter(raw);
    frontmatter = p.frontmatter as Record<string, unknown>;
    body = p.body;
  } catch {
    body = raw;
  }
  const id = agentIdFromFrontmatter(frontmatter, defaultId);
  const fileOptions = parseFileOptionsFromFrontmatter(frontmatter);
  const trimmed = body.trim();
  if (!trimmed) return null;
  return { id, prompt: trimmed, fileOptions };
}

function loadMdAgentFile(path: string): {
  id: string;
  prompt: string;
  fileOptions: SubagentAgentFileOptions;
} | null {
  if (extname(path).toLowerCase() !== ".md") return null;
  try {
    const raw = readFileSync(path, "utf8");
    const base = basename(path, ".md");
    const parsed = parseAgentMarkdown(raw, base);
    if (!parsed || parsed.prompt.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function collectMdFilesInDir(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      const p = join(dir, name);
      try {
        if (statSync(p).isFile()) out.push(p);
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }
  return out;
}

type PackageJsonPi = {
  extensions?: string[];
  agents?: string[];
};

function readPackageJsonPi(packageJsonPath: string): PackageJsonPi | null {
  if (!existsSync(packageJsonPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      pi?: PackageJsonPi;
    };
    return pkg.pi ?? null;
  } catch {
    return null;
  }
}

function resolveExtensionRoot(entry: string, cwd: string): string | null {
  const p = resolve(cwd, entry);
  try {
    const st = statSync(p);
    return st.isDirectory() ? p : dirname(p);
  } catch {
    return null;
  }
}

function readPiAgentsDirsFromPackageRoot(extRoot: string): string[] {
  const pi = readPackageJsonPi(join(extRoot, "package.json"));
  const entries = pi?.agents;
  if (!Array.isArray(entries)) return [];
  const out: string[] = [];
  for (const e of entries) {
    if (typeof e !== "string" || !e.trim()) continue;
    const d = resolve(extRoot, e.trim());
    if (existsSync(d)) out.push(d);
  }
  return out;
}

function extensionRootsFromProject(cwd: string): string[] {
  const pi = readPackageJsonPi(join(cwd, "package.json"));
  const ext = pi?.extensions;
  if (!Array.isArray(ext)) return [];
  const roots: string[] = [];
  for (const entry of ext) {
    if (typeof entry !== "string" || !entry.trim()) continue;
    const root = resolveExtensionRoot(entry.trim(), cwd);
    if (root) roots.push(root);
  }
  return roots;
}

function projectManifestAgentDirs(cwd: string): string[] {
  return readPiAgentsDirsFromPackageRoot(cwd);
}

type ScanLayer = { dirs: string[] };

export function buildSubagentAgentCatalog(cwd: string): SubagentAgentCatalog {
  const layers: ScanLayer[] = [
    { dirs: [shippedAgentsDir()] },
    { dirs: [join(homedir(), ".config", "pi", "agents")] },
    { dirs: [join(cwd, ".pi", "agents")] },
    { dirs: projectManifestAgentDirs(cwd) },
  ];
  const extDirs: string[] = [];
  for (const root of extensionRootsFromProject(cwd)) {
    extDirs.push(...readPiAgentsDirsFromPackageRoot(root));
  }
  layers.push({ dirs: extDirs });

  const agents = new Map<string, SubagentAgentEntry>();
  for (const layer of layers) {
    for (const dir of layer.dirs) {
      for (const file of collectMdFilesInDir(dir)) {
        const row = loadMdAgentFile(file);
        if (!row) continue;
        agents.set(row.id, {
          prompt: row.prompt,
          fileOptions: row.fileOptions,
        });
      }
    }
  }
  if (!agents.has("default")) {
    agents.set("default", { prompt: ULTIMATE_DEFAULT_PROMPT, fileOptions: {} });
  }
  return { agents };
}

export function resolveSubagentAgentId(
  raw: string | undefined,
  catalog: SubagentAgentCatalog,
): string {
  const t = normalizeSubagentAgentId(raw ?? "");
  if (t && catalog.agents.has(t)) return t;
  return "default";
}

export function subagentSystemPromptFromCatalog(
  agentId: string,
  catalog: SubagentAgentCatalog,
): string {
  return (
    catalog.agents.get(agentId)?.prompt ??
    catalog.agents.get("default")?.prompt ??
    ULTIMATE_DEFAULT_PROMPT
  );
}

function escapeXmlText(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function subagentsPersonasSystemPromptXml(
  catalog: SubagentAgentCatalog,
): string {
  const ids = [...catalog.agents.keys()].sort((a, b) => a.localeCompare(b));
  const lines = ["<subagents>"];
  for (const id of ids) {
    const entry = catalog.agents.get(id);
    if (!entry) continue;
    const description = entry.fileOptions.description?.trim() ?? "";
    lines.push("  <agent>");
    lines.push(`    <name>${escapeXmlText(id)}</name>`);
    lines.push(`    <description>${escapeXmlText(description)}</description>`);
    lines.push("  </agent>");
  }
  lines.push("</subagents>");
  return lines.join("\n");
}
