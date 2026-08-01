import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "./atomic.ts";
import { rebuildMeta } from "./meta.ts";
import { vaultLayout } from "./paths.ts";

export const PAGE_TYPES = ["source", "concept", "entity", "synthesis", "analysis"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export interface BootstrapOptions {
  topic?: string;
  now?: Date | (() => Date);
}

export interface BootstrapResult {
  root: string;
  created: boolean;
  createdFiles: string[];
  topic?: string;
}

const CONFIG_SCHEMA_VERSION = 1;
const TOPIC_MARKER_OPEN = "<!-- llm-wiki:topic -->";
const TOPIC_MARKER_CLOSE = "<!-- /llm-wiki:topic -->";
const TOPIC_PLACEHOLDER = "(unset — pass a topic to wiki_bootstrap or /wiki-init)";

function resolveNow(now: Date | (() => Date) | undefined): Date {
  if (now instanceof Date) return now;
  return typeof now === "function" ? now() : new Date();
}

function writeFileIfAbsent(root: string, absPath: string, content: string, created: string[]): void {
  if (fs.existsSync(absPath)) return;
  atomicWriteFile(absPath, content);
  created.push(path.relative(root, absPath));
}

function buildConfigJson(createdAt: string): string {
  const config = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    createdAt,
    pageTypes: [...PAGE_TYPES],
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

function buildSchema(): string {
  return `# Wiki Schema

This is the operating manual for the vault. It states the structure, page types,
and conventions the LLM follows while maintaining the wiki. Co-evolve it as the
wiki grows. See \`purpose.md\` for *why* this wiki exists.

## Vault layout

\`\`\`
config.json              vault-local config (schemaVersion, createdAt, pageTypes)
WIKI_SCHEMA.md           this document (structural rules)
purpose.md               directional intent (goals, key questions, scope, thesis)
templates/               one markdown template per Page Type
inbox/                   drop zone for un-captured source files
raw/sources/SRC-YYYY-MM-DD-NNN/   immutable Source Packets
  manifest.json          origin metadata + originPath/originHash + ingest state
  original/              artifact as captured (immutable)
  extracted.md           normalized text
wiki/                    LLM-maintained Wiki Pages
  sources/ concepts/ entities/ syntheses/ analyses/
  overview.md            LLM-maintained global summary
meta/                    generated, extension-owned (registry, backlinks, events, ...)
\`\`\`

## Page Types

Every Wiki Page is classified by exactly one \`type\` in its frontmatter. The type
drives the template and the type-affinity signal of Graph Relevance.

- **source** — what one Raw Source says. One Source Packet digest.
- **concept** — a recurring idea that spans sources.
- **entity** — a person, organization, product, or paper.
- **synthesis** — a cross-source thesis built from several sources.
- **analysis** — a filed answer from a Query.

## Frontmatter conventions

- \`type\` — one of the Page Types above (required).
- \`title\` — human-readable title (required).
- \`aliases\` — alternative names; used for alias dedup via the registry.
- \`sources\` — list of Source Packet ids (\`SRC-YYYY-MM-DD-NNN\`) the page draws on.
- \`related\` — \`[[wikilinks]]\` to related pages.

## Citations and wikilinks

Cite a claim to its Source Packet with a wikilink, e.g. \`[[sources/SRC-2024-01-05-001]]\`.
Obsidian-compatible \`[[wikilinks]]\` are the cross-reference mechanism; they feed
both backlinks and Graph Relevance.

## Workflow

\`\`\`
inbox / url / pasted text  ->  wiki_capture  ->  Source Packet (immutable)
Source Packet  ->  wiki_ingest  ->  typed Wiki Pages with citations
question  ->  wiki_recall / wiki_search  ->  answer (may be filed as an Analysis); /wiki-query runs this interactively
wiki_lint  ->  health checks (orphans, broken links, coverage gaps, inbox drift)
\`\`\`

Raw Sources are immutable. Generated metadata under \`meta/\` is derived data,
rebuildable from \`raw/**\` and \`wiki/**\` at any time. Never edit \`raw/**\` or
\`meta/**\` directly — the tools own those paths.
`;
}

function buildPurpose(topic: string): string {
  return `---
type: purpose
---

# Purpose

## Topic

${TOPIC_MARKER_OPEN}
${topic}
${TOPIC_MARKER_CLOSE}

## Goals

What this wiki should achieve.

## Key questions

The questions this wiki exists to answer.

## Scope

In scope and out of scope.

## Evolving thesis

The current synthesis, updated as the wiki grows.
`;
}

function applyTopic(purposePath: string, topic: string): void {
  if (!fs.existsSync(purposePath)) return;
  const current = fs.readFileSync(purposePath, "utf8");
  const re = new RegExp(`${TOPIC_MARKER_OPEN}[\\s\\S]*?${TOPIC_MARKER_CLOSE}`);
  if (!re.test(current)) return;
  const updated = current.replace(re, `${TOPIC_MARKER_OPEN}\n${topic}\n${TOPIC_MARKER_CLOSE}`);
  if (updated === current) return;
  atomicWriteFile(purposePath, updated);
}

const TEMPLATE_SOURCE = `---
type: source
title:
aliases: []
sources: []
---

# <title>

> One Source Packet digest: what this single Raw Source says.

## Summary

## Key claims

- (cite each claim to its Source Packet, e.g. [[sources/SRC-YYYY-MM-DD-NNN]])

## Notes
`;

const TEMPLATE_CONCEPT = `---
type: concept
title:
aliases: []
sources: []
related: []
---

# <title>

> A recurring idea that spans multiple sources.

## Definition

## Where it appears

## Tensions / open questions
`;

const TEMPLATE_ENTITY = `---
type: entity
kind:
title:
aliases: []
sources: []
related: []
---

# <title>

> A person, organization, product, or paper.

## Summary

## Relevant facts

## Relationships
`;

const TEMPLATE_SYNTHESIS = `---
type: synthesis
title:
aliases: []
sources: []
related: []
---

# <title>

> A cross-source thesis built from several sources.

## Thesis

## Evidence

- (cite each supporting claim to its Source Packet)

## Counter-evidence
`;

const TEMPLATE_ANALYSIS = `---
type: analysis
question:
title:
aliases: []
sources: []
related: []
---

# <title>

> A filed answer from a Query.

## Question

## Answer

## Reasoning

## Sources
`;

const TEMPLATES: ReadonlyArray<readonly [PageType, string]> = [
  ["source", TEMPLATE_SOURCE],
  ["concept", TEMPLATE_CONCEPT],
  ["entity", TEMPLATE_ENTITY],
  ["synthesis", TEMPLATE_SYNTHESIS],
  ["analysis", TEMPLATE_ANALYSIS],
];

export function bootstrapVault(root: string, opts: BootstrapOptions = {}): BootstrapResult {
  const layout = vaultLayout(root);
  const now = resolveNow(opts.now);
  const topic = opts.topic?.trim() || undefined;

  const createdFiles: string[] = [];

  const dirs = [
    layout.inbox,
    layout.sourcesRoot,
    layout.wiki,
    layout.wikiSources,
    layout.wikiConcepts,
    layout.wikiEntities,
    layout.wikiSyntheses,
    layout.wikiAnalyses,
    layout.meta,
    layout.templates,
  ];
  for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });

  writeFileIfAbsent(root, layout.config, buildConfigJson(now.toISOString()), createdFiles);
  writeFileIfAbsent(root, layout.schema, buildSchema(), createdFiles);
  writeFileIfAbsent(root, layout.purpose, buildPurpose(topic ?? TOPIC_PLACEHOLDER), createdFiles);
  for (const [type, body] of TEMPLATES) {
    writeFileIfAbsent(root, path.join(layout.templates, `${type}.md`), body, createdFiles);
  }

  writeFileIfAbsent(root, layout.events, "", createdFiles);
  writeFileIfAbsent(root, layout.review, "", createdFiles);
  writeFileIfAbsent(root, layout.lintReport, "", createdFiles);

  if (topic) applyTopic(layout.purpose, topic);

  if (createdFiles.length > 0) rebuildMeta(root);

  return {
    root,
    created: createdFiles.length > 0,
    createdFiles,
    ...(topic ? { topic } : {}),
  };
}
