# @htwang-contrib/llm-wiki

A pi extension that builds and maintains a persistent, interlinked markdown wiki from curated sources, following Karpathy's LLM Wiki pattern. Knowledge is **compiled once and kept current** from immutable Raw Sources, not re-derived per query.

The agent captures a source into an immutable **Source Packet**, ingests it into typed, cited **Wiki Pages**, answers questions against the wiki via **Layered Recall**, lints its health, and files anything needing human judgment into a **Review Queue**.

## Features

- **Dual-layer vaults** — a Personal Vault at `~/.llm-wiki/` (always active, compounds across sessions) and an opt-in Project Vault at `<project>/.llm-wiki/`; recall merges both
- **Immutable Source Packets** — `raw/sources/SRC-YYYY-MM-DD-NNN/` holds the original artifact, a normalized `extracted.md`, and a manifest with origin metadata + content hash; re-capture is idempotent
- **Two-step ingest** — analysis, then generation; runs unattended as side-calls (batch) or interactively in conversation, with retry on bad LLM output
- **Layered Recall** — keyword search plus a four-signal **Graph Relevance** model (direct link, source overlap, Adamic-Adar, type affinity) over the wikilink graph, merged across both vaults
- **Review Queue** — async human-in-the-loop; ingest files items needing judgment with a constrained action (`create_page` / `deep_research` / `skip`) and a pre-built query
- **Lint + guardrails** — mechanical health checks (`meta/lint-report.md`); direct `write`/`edit` into `raw/**` and `meta/**` is blocked, and metadata rebuilds itself at end of turn whenever `wiki/**` changes
- **Bundled skill + prompt** — ships `skills/llm-wiki/SKILL.md` and the `/wiki-query` prompt template via the extension's `resources_discover` hook

## Install

This package is part of the `pi-extensions` monorepo. From the repo root:

```sh
npm install
npm run build        # or: npx tsc -p packages/llm-wiki
```

Enable the extension in pi (it registers under the **LLM Wiki** group in `/config`). URL captures use the `@htwang-contrib/web-tools` provider chain (Jina/Firecrawl) — configure those API keys separately.

## Quickstart

Bootstrap a vault (one-time setup; idempotent):

```sh
node packages/llm-wiki/scripts/bootstrap.ts                  # creates ./.llm-wiki (project vault)
node packages/llm-wiki/scripts/bootstrap.ts ~ --topic "X"    # creates ~/.llm-wiki (personal vault)
```

Then in a pi session:

1. Capture a source → `wiki_capture` (or drop a file into the vault `inbox/`).
2. Ingest the backlog → `/wiki-ingest` (batch side-calls) or interactively per the bundled skill.
3. Ask against the wiki → `/wiki-query <question>` (read-only; cites Source Packets).
4. Health-check → `/wiki-lint` (append `--fix` to auto-capture uncaptured Inbox files).
5. Resolve deferred items → `/wiki-review`.

## Tools

| Tool | Purpose |
| --- | --- |
| `wiki_capture` | Capture a URL / pasted text / local `.md`/`.txt` into an immutable Source Packet. Idempotent. |
| `wiki_ingest` | Batch-ingest every pending Source Packet into typed, cited Wiki Pages via two retried side-calls. Optional `packetId` for one packet. |
| `wiki_ensure_page` | Resolve-or-create a typed Wiki Page (`source` \| `concept` \| `entity` \| `synthesis` \| `analysis`) from its template. |
| `wiki_recall` | Layered Recall — keyword + Graph Relevance across **both** vaults, merged and deduped by page id. |
| `wiki_search` | Keyword search over **one** vault (the active vault); no graph expansion. |
| `wiki_review` | List / resolve Review Queue items (`action: list \| resolve`). |
| `wiki_lint` | Mechanical checks → `meta/lint-report.md`; `fix: true` auto-captures uncaptured Inbox files. |
| `wiki_status` | Counts, pending ingests/reviews, Inbox drift, recent events for the active vault. |
| `wiki_rebuild_meta` | Rebuild all derived `meta/` artifacts for the active vault. |

## Commands

| Command | Description |
| --- | --- |
| `/wiki-ingest [packetId]` | Run the batch ingest pipeline directly via side-calls. |
| `/wiki-query <question>` | Read-only Query workflow; files the answer as an Analysis page only when explicitly asked. |
| `/wiki-review` | Walk open Review Queue items one by one interactively. |
| `/wiki-lint [--fix]` | Run the Lint engine; `--fix` applies the single safe auto-repair. |
| `/wiki-status` | Print the active vault's status summary. |

## Configuration

Surfaced through `/config` → **LLM Wiki**:

| Item | Type | Default | Description |
| --- | --- | --- | --- |
| `ingestModel` | select | `(use session model)` | Model for batch `wiki_ingest` side-calls; empty follows the session model. |
| `ingestMaxAttempts` | number | `3` | Max attempts per side-call on unparseable output or provider error (`1` = no retry). |
| `sessionStartNotice` | boolean | `true` | One-line status hint at session start (Inbox drift / pending ingest / pending review). |

## Vault layout

Created by `bootstrapVault` (idempotent — re-running only fills in what is missing, never overwrites user-authored pages):

```
{.llm-wiki | ~/.llm-wiki}/
├── config.json          # vault config
├── WIKI_SCHEMA.md       # Schema — operating manual (structural rules)
├── purpose.md           # Purpose — why this wiki exists (read on every ingest/query)
├── templates/           # one template per Page Type
├── inbox/               # default Inbox drop zone
├── raw/sources/SRC-YYYY-MM-DD-NNN/
│   ├── manifest.json    # origin metadata + originPath/originHash + ingest state
│   ├── original/        # artifact as captured (immutable)
│   └── extracted.md     # normalized text
├── wiki/
│   ├── sources/ concepts/ entities/ syntheses/ analyses/
│   └── overview.md      # LLM-maintained global summary
└── meta/                # generated, extension-owned (never edit directly)
    ├── registry.json backlinks.json index.md
    ├── events.jsonl review.jsonl log.md lint-report.md
```

The **active vault** for write/capture tools is the Project Vault if present, else the Personal Vault. Recall always searches both.

## Relationship with the `memory` extension

`llm-wiki` and `memory` are **separate tool sets for separate recall intents** — consult the right one, do not duplicate.

| | `memory` (`memory-*`, `journal-*`) | `llm-wiki` (`wiki_*`) |
| --- | --- | --- |
| Stores | Agent autobiographical state | Compiled, source-cited knowledge |
| Content | Who the user is, preferences, decisions, corrections | What documented sources say about a subject |
| Recall when | The answer could depend on history or context | The answer is factual/technical/domain, with sources |
| Shape | Small, high-signal behavior deltas | Interlinked Wiki Pages traced to Raw Sources |

Rule of thumb: *"what I know about the user or how I should act"* → memory. *"what the cited sources say about a subject"* → wiki. They never collide — different tools, different stores.

## Dependencies

- `@earendil-works/pi-coding-agent` — extension API
- `@htwang-contrib/common` — shared utilities, config-items, pi-free `time` sub-entry
- `@htwang-contrib/web-tools` — URL fetch provider chain (Jina / Firecrawl)
- `yaml` — frontmatter parsing; `typebox` — tool parameter schemas

## Design documents

- Glossary: [docs/llm-wiki/CONTEXT.md](../../docs/llm-wiki/CONTEXT.md)
- Implementation plan: [docs/llm-wiki/PLAN.md](../../docs/llm-wiki/PLAN.md)
- Decisions: [docs/llm-wiki/adr/](../../docs/llm-wiki/adr) — heavy deterministic tools (ADR-0001), lock-free concurrency (ADR-0002)
