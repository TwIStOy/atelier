# LLM Wiki — Implementation Plan

v1 scope and task breakdown. Glossary: [CONTEXT.md](./CONTEXT.md). Decisions: [adr/](./adr/).

## Package

- `packages/llm-wiki`, name `@htwang-contrib/llm-wiki`, standard monorepo layout (`main: src/index.ts`, dep `@htwang-contrib/common`, devDeps pi packages).
- Core vault logic is pi-free (plain fs/TS modules under `src/core/`) for testability; the pi binding (`src/index.ts`, tools, commands, events) is a thin layer over it.

## Vault layout (created by bootstrap)

```
{.llm-wiki | ~/.llm-wiki}/
├── config.json          # vault config
├── WIKI_SCHEMA.md       # Schema (structural rules)
├── purpose.md           # Purpose (directional intent)
├── templates/           # one template per Page Type
├── inbox/               # default Inbox (configurable)
├── raw/sources/SRC-YYYY-MM-DD-NNN/
│   ├── manifest.json    # origin metadata + originPath/originHash + ingest state
│   ├── original/        # artifact as captured (immutable)
│   └── extracted.md     # normalized text
├── wiki/
│   ├── sources/ concepts/ entities/ syntheses/ analyses/
│   └── overview.md      # LLM-maintained global summary
└── meta/                # generated, extension-owned
    ├── registry.json backlinks.json index.md
    ├── events.jsonl log.md lint-report.md review.jsonl
```

## Tools (v1, snake_case)

| Tool | Purpose |
| --- | --- |
| `wiki_capture` | URL (web-tools Jina/Firecrawl provider) / pasted text / local md/txt → Source Packet. Copy + originPath/originHash registration; drains Inbox files |
| `wiki_ingest` | Batch mode: two-step (analysis → generation) via `executeSideCall`, serial, updates manifests + review queue. No-arg interactive mode is skill-guided in-conversation |
| `wiki_ensure_page` | Resolve-or-create a typed Wiki Page from template (alias dedup via registry) |
| `wiki_recall` | Layered Recall: registry keyword + Graph Relevance expansion, both vaults merged |
| `wiki_search` | Registry search within one vault |
| `wiki_review` | List/resolve Review Queue items (actions constrained: `create_page` / `deep_research` / `skip`) |
| `wiki_lint` | Mechanical checks: orphans, broken wikilinks, duplicate aliases, coverage gaps, Inbox drift (new/modified sources); `--fix` for safe repairs; writes lint-report.md |
| `wiki_status` | Page/source counts, pending ingests, unresolved reviews, recent events |
| `wiki_rebuild_meta` | Full metadata rebuild from `raw/**` + `wiki/**` |
| `wiki_log_event` | Append a structured event (used by tools internally; exposed for Interactive Ingest bookkeeping) |

Slash commands: `/wiki-ingest`, `/wiki-query`, `/wiki-review`, `/wiki-lint`, `/wiki-status`.

Vault bootstrap is a one-time setup, so it is a standalone script (`packages/llm-wiki/scripts/bootstrap.ts`), not a pi tool or slash command: `node packages/llm-wiki/scripts/bootstrap.ts [parent-dir] [--topic "<text>"]` creates the vault at `<parent-dir>/.llm-wiki` (defaults to `<cwd>`).

Config items (`registerConfigItems`, surfaced via `/config`): personal vault path override, Inbox path, ingest side-call model, session-start notice on/off.

## Cross-cutting mechanics

- **Guardrails**: `pi.on("tool_call")` interceptor blocks direct `write`/`edit` to `raw/**` and `meta/**`; end-of-turn auto-rebuild of metadata when `wiki/**` was touched (pattern proven by `permission-system`).
- **Lock-free writes** (ADR-0002): tmp+rename everywhere, `mkdir`-allocated Source Packet IDs, append-only `events.jsonl`.
- **Session start**: resolve vaults, scan Inbox (new path / changed hash), inject a one-line notice (new sources, pending ingests, unresolved reviews).
- **Bundled skill**: `skills/llm-wiki/SKILL.md` shipped via extension skill paths — ingest/query/lint/review workflows, Interactive Ingest two-step discipline, citation style (`[[sources/SRC-…]]`), filing answers as Analysis pages, coordination with the memory extension (separate tools, when to consult which).
- **Graph Relevance**: 4-signal local model (direct link ×3, source overlap ×4, Adamic-Adar ×1.5, type affinity ×1) over the wikilink graph + frontmatter `sources[]`.

## Task breakdown (dependency order)

1. Scaffold package (tsconfig, biome, entry)
2. Core: vault resolution (dual-layer discovery) + layout constants
3. Core: atomic fs primitives (tmp+rename, append, mkdir ID allocation, content hash)
4. Core: Source Packet store + manifest schema + `wiki_capture` (URL via web-tools provider — export what's needed from `web-tools`, else thin `r.jina.ai` wrapper; text/file)
5. Core: metadata engine (registry, backlinks, index, events→log, rebuild)
6. Guardrails interceptor + end-of-turn auto-rebuild
7. `wiki_bootstrap` core + templates + standalone bootstrap script (revised: not a tool/command)
8. `wiki_ensure_page` + five Page Types + frontmatter conventions
9. Recall: registry search + Graph Relevance (`wiki_recall`, `wiki_search`)
10. `wiki_ingest` batch pipeline (side-call two-step, serial, ingest-model config) + `/wiki-ingest`
11. Review queue store + `wiki_review` + `/wiki-review`
12. `wiki_lint` + Inbox scan + `wiki_status` + session-start notice
13. Bundled SKILL.md + `/wiki-query` (read-only default, opt-in filing as Analysis)
14. Hardening: core tests, `npm run fmt && npm run check`, CHANGELOG, README

## v1.1 hooks (designed for, not built)

- **qmd vector recall**: seam in `wiki_recall` behind a recall-provider interface; qmd absent → current registry+graph behavior is the fallback.
- **Deep Research automation**: pipeline reusing `web-tools` search providers → `wiki_capture` → `wiki_ingest`; in v1 the `deep_research` review action is performed interactively by the agent.

## Explicitly out

- MCP server (never — wiki is pi-exclusive; the vault is plain markdown)
- Multi-format parsing (PDF/Office/EPUB)
- Remote URL staleness detection
