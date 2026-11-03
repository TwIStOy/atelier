// fallow-ignore-file unused-file
// Disabled helpers kept for a future opt-in auto-recall (see commit 5d128fe).
import { runHat } from "./cli-runner.js";

export interface RecallEntry {
  uri: string;
  domain: string;
  path: string;
  priority: number;
  disclosure: string;
  content: string;
}

const SNIPPET_CHARS = 700;
const MAX_INJECT = 8;

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "when",
  "working",
  "work",
  "works",
  "worktree",
  "worker",
  "in",
  "on",
  "at",
  "with",
  "for",
  "of",
  "to",
  "and",
  "or",
  "from",
  "into",
  "via",
  "repo",
  "repository",
  "project",
  "projects",
  "package",
  "packages",
  "user",
  "users",
  "home",
  "code",
  "src",
  "file",
  "files",
  "dir",
  "docs",
  "doc",
  "that",
  "this",
  "is",
  "are",
  "was",
  "be",
  "been",
  "has",
  "have",
  "had",
  "it",
  "its",
  "how",
  "do",
  "we",
  "handle",
  "use",
  "using",
  "used",
  "set",
  "get",
  "new",
  "make",
  "add",
  "run",
  "build",
  "test",
  "debug",
  "fix",
  "state",
  "config",
  "dev",
  "local",
  "var",
  "etc",
  "opt",
  "tmp",
  "documents",
  "github",
  "workspace",
]);

const TOKEN_RE = /[a-z0-9][a-z0-9_-]{2,}/g;
const WORD_RE = /[a-z0-9_-]+/g;

function homeBasename(): string {
  const h = process.env.HOME ?? "";
  const segs = h.split("/").filter(Boolean);
  const base = segs[segs.length - 1];
  return base ? base.toLowerCase() : "";
}

export function tokenize(s: string): string[] {
  const home = homeBasename();
  const matches = s.toLowerCase().match(TOKEN_RE) ?? [];
  return matches.filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t) && t !== home);
}

function disclosureWords(d: string): Set<string> {
  return new Set(d.toLowerCase().match(WORD_RE) ?? []);
}

export type RecallReason = "project" | "topic";

export interface MatchedRecall {
  entry: RecallEntry;
  hits: string[];
  reason: RecallReason;
}

/**
 * Match recall entries against the current cwd and prompt.
 *
 * Two channels with different precision:
 * - project (cwd): single token overlap. cwd tokens (git root, path segments)
 *   are high-specificity, so one hit is enough.
 * - topic (prompt): require 2+ token overlap. Prompts are natural language and
 *   noisy, so a single common word must not trigger injection.
 */
export function matchRecall(entries: RecallEntry[], cwd: string, prompt: string): MatchedRecall[] {
  const cwdTokens = new Set(tokenize(cwd));
  const promptTokens = new Set(tokenize(prompt));
  const seen = new Set<string>();
  const out: MatchedRecall[] = [];

  for (const entry of entries) {
    if (seen.has(entry.uri)) continue;
    const words = disclosureWords(entry.disclosure);

    const cwdHits = [...words].filter((w) => cwdTokens.has(w));
    if (cwdHits.length > 0) {
      seen.add(entry.uri);
      out.push({ entry, hits: cwdHits, reason: "project" });
      continue;
    }

    const promptHits = [...words].filter((w) => promptTokens.has(w));
    if (promptHits.length >= 2) {
      seen.add(entry.uri);
      out.push({ entry, hits: promptHits, reason: "topic" });
    }
  }

  out.sort((a, b) => a.entry.priority - b.entry.priority);
  return out.slice(0, MAX_INJECT);
}

function snippet(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_CHARS ? `${flat.slice(0, SNIPPET_CHARS)} …` : flat;
}

export function buildRecallBlock(matches: MatchedRecall[]): string {
  if (matches.length === 0) return "";
  const lines = matches.map((m) => {
    const tag = m.reason === "project" ? "project" : "topic";
    return `- ${m.entry.uri} (p${m.entry.priority}, [${tag}: ${m.hits.join(",")}]) ${m.entry.disclosure}\n  ${snippet(m.entry.content)}`;
  });
  return [
    "<recalled_memory>",
    "Auto-recalled from persistent memory: these nodes' disclosure triggers matched the current project (cwd) or prompt topic. Treat as a shallow prefetch — run memory-read / memory-search for full context or more results.",
    "",
    lines.join("\n"),
    "</recalled_memory>",
  ].join("\n");
}

/** Fetch the flat recall index via `hat memory recall-index`. Best-effort. */
export async function fetchRecallIndex(): Promise<RecallEntry[]> {
  const res = await runHat(["memory", "recall-index"]);
  if (Array.isArray(res)) return res as RecallEntry[];
  if (res && typeof res === "object") {
    const r = res as Record<string, unknown>;
    if (Array.isArray(r.results)) return r.results as RecallEntry[];
    if (Array.isArray(r.data)) return r.data as RecallEntry[];
  }
  return [];
}
