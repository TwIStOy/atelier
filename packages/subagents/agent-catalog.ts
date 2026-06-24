import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

export const SUBAGENT_FALLBACK_AGENT_ID = "general-purpose" as const;

const ULTIMATE_DEFAULT_PROMPT =
  "You are a focused sub-agent running inside the same Pi process. Use your tools to complete the assignment. When done, reply with a concise final summary for the parent agent.";

export type SubagentAgentFileOptions = {
  description?: string;
  whenToUse?: string;
  model?: string;
  thinking?: string;
  inherit_context?: boolean;
  isolated?: boolean;
  max_turns?: number;
  tools?: string[];
};

export type SubagentAgentEntry = {
  prompt: string;
  fileOptions: SubagentAgentFileOptions;
  sourcePath: string;
};

export type SubagentAgentCatalog = {
  agents: Map<string, SubagentAgentEntry>;
};

export type SubagentAgentType = string;

function shippedAgentsDir(): string {
  return fileURLToPath(new URL("./agents/", import.meta.url));
}

export function normalizeSubagentAgentId(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "-");
  if (!/^[a-z][a-z0-9_-]*$/.test(s)) return "";
  return s;
}

function agentIdFromFrontmatter(fm: Record<string, unknown>, defaultId: string): string {
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
  const v = fm["max_turns"];
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
  const v = fm["tools"];
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

function parseFileOptionsFromFrontmatter(fm: Record<string, unknown>): SubagentAgentFileOptions {
  const descriptionRaw = parseStringField(fm, "description");
  const description = descriptionRaw && descriptionRaw.length > 72 ? descriptionRaw.slice(0, 72) : descriptionRaw;
  const whenToUseRaw = parseStringField(fm, "whenToUse") ?? parseStringField(fm, "when_to_use");
  const whenToUse = whenToUseRaw && whenToUseRaw.length > 2000 ? whenToUseRaw.slice(0, 2000) : whenToUseRaw;
  const model = parseStringField(fm, "model");
  const thinking = parseStringField(fm, "thinking");
  const inherit_context = parseBooleanField(fm, "inherit_context");
  const isolated = parseBooleanField(fm, "isolated");
  const max_turns = parseMaxTurnsField(fm);
  const tools = parseToolsField(fm);
  const out: SubagentAgentFileOptions = {};
  if (description) out.description = description;
  if (whenToUse) out.whenToUse = whenToUse;
  if (model) out.model = model;
  if (thinking) out.thinking = thinking;
  if (inherit_context !== undefined) out.inherit_context = inherit_context;
  if (isolated !== undefined) out.isolated = isolated;
  if (max_turns !== undefined) out.max_turns = max_turns;
  if (tools !== undefined) out.tools = tools;
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
          sourcePath: resolvePath(file),
        });
      }
    }
  }
  if (!agents.has(SUBAGENT_FALLBACK_AGENT_ID)) {
    agents.set(SUBAGENT_FALLBACK_AGENT_ID, {
      prompt: ULTIMATE_DEFAULT_PROMPT,
      fileOptions: {},
      sourcePath: `<built-in ${SUBAGENT_FALLBACK_AGENT_ID}>`,
    });
  }
  return { agents };
}

export function resolveSubagentAgentId(raw: string | undefined, catalog: SubagentAgentCatalog): string {
  const t = normalizeSubagentAgentId(raw ?? "");
  if (t && catalog.agents.has(t)) return t;
  return SUBAGENT_FALLBACK_AGENT_ID;
}

function escapeXmlText(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function subagentSystemPromptFromCatalog(agentId: string, catalog: SubagentAgentCatalog): string {
  const row = catalog.agents.get(agentId);
  const fallbackRow = catalog.agents.get(SUBAGENT_FALLBACK_AGENT_ID);
  const entry = row ?? fallbackRow;
  const body = entry?.prompt ?? ULTIMATE_DEFAULT_PROMPT;
  const whenToUse = entry?.fileOptions.whenToUse?.trim() ?? "";
  if (!whenToUse) return body;
  return `<when_to_use>\n${escapeXmlText(whenToUse)}\n</when_to_use>\n\n${body}`;
}

export function subagentsPersonasSystemPromptXml(catalog: SubagentAgentCatalog): string {
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
