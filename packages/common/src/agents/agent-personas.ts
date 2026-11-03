import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { createLogger } from "../log.ts";

const log = createLogger("agent-personas");

export const FALLBACK_PERSONA_ID = "general-purpose" as const;

const ULTIMATE_DEFAULT_PROMPT =
  "You are a focused sub-agent running inside the same Pi process. Use your tools to complete the assignment. When done, reply with a concise final summary for the parent agent.";

export type AgentPersonaFileOptions = {
  description?: string;
  whenToUse?: string;
  model?: string;
  thinking?: string;
  inherit_context?: boolean;
  isolated?: boolean;
  max_turns?: number;
  tools?: string[];
};

export type AgentPersonaEntry = {
  prompt: string;
  fileOptions: AgentPersonaFileOptions;
  sourcePath: string;
};

export type AgentPersonaCatalog = {
  agents: Map<string, AgentPersonaEntry>;
  warnings: string[];
};

export type BuildAgentPersonaCatalogOptions = {
  shippedDirs?: string[];
};

export function normalizePersonaId(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "-");
  if (!/^[a-z][a-z0-9_-]*$/.test(s)) return "";
  return s;
}

function personaIdFromFrontmatter(fm: Record<string, unknown>, defaultId: string): string {
  const n = fm.name;
  if (typeof n === "string" && n.trim()) {
    const x = normalizePersonaId(n);
    if (x) return x;
  }
  if (typeof n === "number" && Number.isFinite(n)) {
    const x = normalizePersonaId(String(n));
    if (x) return x;
  }
  return defaultId;
}

function parseStringField(fm: Record<string, unknown>, key: string): string | undefined {
  const v = fm[key];
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function parseBooleanField(fm: Record<string, unknown>, key: string): boolean | undefined {
  const v = fm[key];
  if (typeof v === "boolean") return v;
  return undefined;
}

function parseMaxTurnsField(fm: Record<string, unknown>): number | undefined {
  const v = fm.max_turns;
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const n = Math.floor(v);
  return n >= 1 ? n : undefined;
}

function dedupePreserveOrder(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function parseToolsField(fm: Record<string, unknown>): string[] | undefined {
  const v = fm.tools;
  if (v === undefined) return undefined;
  const norm = (s: string) => s.trim().toLowerCase();
  let names: string[] = [];
  if (Array.isArray(v)) {
    for (const x of v) {
      if (typeof x !== "string") continue;
      const t = norm(x);
      if (t) names.push(t);
    }
  } else if (typeof v === "string") {
    names = v
      .split(/[\s,]+/)
      .map(norm)
      .filter(Boolean);
  } else {
    return undefined;
  }
  names = dedupePreserveOrder(names);
  if (names.length === 0) return undefined;
  const max = 50;
  return names.length > max ? names.slice(0, max) : names;
}

function parseFileOptionsFromFrontmatter(fm: Record<string, unknown>): AgentPersonaFileOptions {
  const out: AgentPersonaFileOptions = {};
  applyStringPersonaOptions(out, fm);
  applyFlagPersonaOptions(out, fm);
  return out;
}

function applyStringPersonaOptions(out: AgentPersonaFileOptions, fm: Record<string, unknown>): void {
  const description = clampPersonaLength(parseStringField(fm, "description"), 72);
  const whenToUseRaw = parseStringField(fm, "whenToUse") ?? parseStringField(fm, "when_to_use");
  const whenToUse = clampPersonaLength(whenToUseRaw, 2000);
  const model = parseStringField(fm, "model");
  const thinking = parseStringField(fm, "thinking");
  if (description) out.description = description;
  if (whenToUse) out.whenToUse = whenToUse;
  if (model) out.model = model;
  if (thinking) out.thinking = thinking;
}

function clampPersonaLength(value: string | undefined, max: number): string | undefined {
  return value && value.length > max ? value.slice(0, max) : value;
}

function applyFlagPersonaOptions(out: AgentPersonaFileOptions, fm: Record<string, unknown>): void {
  const inherit_context = parseBooleanField(fm, "inherit_context");
  const isolated = parseBooleanField(fm, "isolated");
  const max_turns = parseMaxTurnsField(fm);
  const tools = parseToolsField(fm);
  if (inherit_context !== undefined) out.inherit_context = inherit_context;
  if (isolated !== undefined) out.isolated = isolated;
  if (max_turns !== undefined) out.max_turns = max_turns;
  if (tools !== undefined) out.tools = tools;
}

function parsePersonaMarkdown(
  raw: string,
  filenameBase: string,
): {
  id: string;
  prompt: string;
  fileOptions: AgentPersonaFileOptions;
} | null {
  const defaultId = normalizePersonaId(filenameBase);
  if (!defaultId) return null;
  let frontmatter: Record<string, unknown> = {};
  let body: string;
  try {
    const p = parseFrontmatter(raw);
    frontmatter = p.frontmatter as Record<string, unknown>;
    body = p.body;
  } catch (e) {
    throw new Error(`invalid frontmatter: ${e instanceof Error ? e.message : String(e)}`);
  }
  const id = personaIdFromFrontmatter(frontmatter, defaultId);
  const fileOptions = parseFileOptionsFromFrontmatter(frontmatter);
  const trimmed = body.trim();
  if (!trimmed) return null;
  return { id, prompt: trimmed, fileOptions };
}

function loadMdPersonaFile(path: string): {
  id: string;
  prompt: string;
  fileOptions: AgentPersonaFileOptions;
} | null {
  if (extname(path).toLowerCase() !== ".md") return null;
  const raw = readFileSync(path, "utf8");
  const base = basename(path, ".md");
  const parsed = parsePersonaMarkdown(raw, base);
  if (!parsed || parsed.prompt.length === 0) return null;
  return parsed;
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
      } catch {}
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
  const p = resolvePath(cwd, entry);
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
    const d = resolvePath(extRoot, e.trim());
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

export function sharedPersonasDir(): string {
  return fileURLToPath(new URL("../../../../agents/", import.meta.url));
}

function personaScanLayers(cwd: string, opts?: BuildAgentPersonaCatalogOptions): ScanLayer[] {
  const layers: ScanLayer[] = [
    { dirs: [sharedPersonasDir(), ...(opts?.shippedDirs ?? [])] },
    { dirs: [join(homedir(), ".config", "pi", "agents")] },
    { dirs: [join(cwd, ".pi", "agents")] },
    { dirs: projectManifestAgentDirs(cwd) },
  ];
  const extDirs: string[] = [];
  for (const root of extensionRootsFromProject(cwd)) {
    extDirs.push(...readPiAgentsDirsFromPackageRoot(root));
  }
  layers.push({ dirs: extDirs });
  return layers;
}

function malformedPersonaWarning(file: string, agents: Map<string, AgentPersonaEntry>, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const base = normalizePersonaId(basename(file, ".md"));
  const replacedBy = agents.get(base)?.sourcePath;
  if (replacedBy) {
    return `skipping malformed agent file ${file}: ${msg}; using ${replacedBy} instead`;
  }
  return `skipping malformed agent file ${file}: ${msg}`;
}

function loadPersonaFromFile(file: string, agents: Map<string, AgentPersonaEntry>): string | null {
  let row: ReturnType<typeof loadMdPersonaFile>;
  try {
    row = loadMdPersonaFile(file);
  } catch (e) {
    return malformedPersonaWarning(file, agents, e);
  }
  if (!row) return null;
  agents.set(row.id, {
    prompt: row.prompt,
    fileOptions: row.fileOptions,
    sourcePath: resolvePath(file),
  });
  return null;
}

function ensureFallbackPersona(agents: Map<string, AgentPersonaEntry>): void {
  if (agents.has(FALLBACK_PERSONA_ID)) return;
  agents.set(FALLBACK_PERSONA_ID, {
    prompt: ULTIMATE_DEFAULT_PROMPT,
    fileOptions: {},
    sourcePath: `<built-in ${FALLBACK_PERSONA_ID}>`,
  });
}

export function buildAgentPersonaCatalog(cwd: string, opts?: BuildAgentPersonaCatalogOptions): AgentPersonaCatalog {
  const layers = personaScanLayers(cwd, opts);
  const agents = new Map<string, AgentPersonaEntry>();
  const warnings: string[] = [];
  for (const layer of layers) {
    for (const dir of layer.dirs) {
      for (const file of collectMdFilesInDir(dir)) {
        const warning = loadPersonaFromFile(file, agents);
        if (warning) warnings.push(warning);
      }
    }
  }
  for (const warning of warnings) log.warn(warning);
  ensureFallbackPersona(agents);
  return { agents, warnings };
}

export function resolvePersonaId(raw: string | undefined, catalog: AgentPersonaCatalog): string {
  const t = normalizePersonaId(raw ?? "");
  if (t && catalog.agents.has(t)) return t;
  return FALLBACK_PERSONA_ID;
}

function escapeXmlText(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function personaSystemPrompt(personaId: string, catalog: AgentPersonaCatalog): string {
  const row = catalog.agents.get(personaId);
  const fallbackRow = catalog.agents.get(FALLBACK_PERSONA_ID);
  const entry = row ?? fallbackRow;
  const body = entry?.prompt ?? ULTIMATE_DEFAULT_PROMPT;
  const whenToUse = entry?.fileOptions.whenToUse?.trim() ?? "";
  if (!whenToUse) return body;
  return `<when_to_use>\n${escapeXmlText(whenToUse)}\n</when_to_use>\n\n${body}`;
}

export function personasCatalogXml(catalog: AgentPersonaCatalog): string {
  const ids = [...catalog.agents.keys()].sort((a, b) => a.localeCompare(b));
  const lines = ["<subagents>"];
  for (const id of ids) {
    const entry = catalog.agents.get(id);
    if (!entry) continue;
    const whenToUse = entry.fileOptions.whenToUse?.trim() ?? "";
    lines.push("  <agent>");
    lines.push(`    <name>${escapeXmlText(id)}</name>`);
    lines.push(`    <when_to_use>${escapeXmlText(whenToUse)}</when_to_use>`);
    lines.push("  </agent>");
  }
  lines.push("</subagents>");
  return lines.join("\n");
}
