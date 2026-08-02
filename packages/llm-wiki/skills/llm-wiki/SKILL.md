---
name: llm-wiki
description: Maintain and query the LLM Wiki — a persistent, interlinked vault of cited Wiki Pages compiled from Raw Sources. Use when capturing sources, ingesting them into Wiki Pages, answering questions against the wiki, linting its health, or resolving the Review Queue.
---

# LLM Wiki

The LLM Wiki compiles knowledge **once** from curated Raw Sources and keeps it current, instead of re-deriving it on every query. It is maintained by the agent between the user and the raw inputs: cross-references, contradictions, and synthesis accumulate over time.

This skill describes the four operations — **Ingest**, **Query**, **Lint**, **Review** — and how they map onto the `wiki_*` tools. Terminology follows the vault's `WIKI_SCHEMA.md` (operating manual) and `purpose.md` (why the wiki exists); read both before the first ingest or query in a session.

## Vaults and Layered Recall

A **Vault** is one rooted wiki. Two are always in play:

- **Personal Vault** at `~/.llm-wiki/` — always active; knowledge compounds across every session.
- **Project Vault** at `<project>/.llm-wiki/` — discovered by walking up from the working directory; opt-in.

The active vault for write/capture tools is the **Project Vault if present, else the Personal Vault**. Recall is **Layered** — it searches both and merges results. Prefer the Project Vault for work tied to a repo; let general knowledge live in the Personal Vault.

## The four operations

```
Inbox / URL / pasted text  ->  wiki_capture  ->  Source Packet (immutable)
Source Packet              ->  Ingest        ->  typed Wiki Pages with citations
question                   ->  Query        ->  cited answer (may be filed as an Analysis)
health                     ->  Lint         ->  meta/lint-report.md
human judgment             ->  Review       ->  Review Queue (create_page / deep_research / skip)
```

### 1. Ingest — integrate a Raw Source into the wiki

A **Raw Source** is an immutable input the agent reads but never modifies. Capture it once into a **Source Packet** (`raw/sources/SRC-YYYY-MM-DD-NNN/` with a manifest, the original artifact, and a normalized `extracted.md`):

- `wiki_capture` (`sourceType: url | text | file`) — idempotent; re-capturing the same path/URL/text returns the existing packet.
- Drop a file into the vault `inbox/` and let `wiki_lint --fix` capture it, or capture explicitly.

**Ingest is two sequential steps — analysis, then generation — and this discipline is mandatory in both modes:**

1. **Analysis.** Read the Source Packet's `extracted.md` alongside the vault's `purpose.md` and an existing-wiki digest. Decide what is genuinely new: key claims, entities, concepts, tensions, and gaps needing human judgment.
2. **Generation.** Only after analysis, write/update typed Wiki Pages that cite the packet, file any Review items, and (if relevant) refresh `wiki/overview.md`.

- **Batch mode** (`wiki_ingest` tool or `/wiki-ingest`): both steps run as side-calls, unattended, one packet at a time. Idempotent and re-entrant — already-ingested packets skip; a failed packet stays pending and retries next call. Prefer this for a backlog of captured packets.
- **Interactive mode** (in the main conversation): perform the two steps yourself. Run `wiki_capture`, then reason through analysis aloud, then call `wiki_ensure_page` (type `source` for the packet digest, plus `concept`/`entity`/`synthesis` as they arise). Keep the two steps distinct — never collapse analysis into page writing. Involve the user where judgment is needed and file Review items instead of guessing.

When a source adds to an **existing** page, ingest unions the packet id into the page's frontmatter `sources[]` additively; do not clobber prior content. Re-ingesting the same packet is a no-op.

### 2. Query — answer against the wiki with citations

`/wiki-query <question>` runs this interactively. The flow:

1. `wiki_recall` (Layered Recall: keyword search + four-signal **Graph Relevance** across both vaults) — or `wiki_search` for a single-vault keyword lookup.
2. `read` the highest-value hits (and the packets they cite via `[[sources/SRC-…]]`).
3. Synthesize a direct answer. **Cite every claim** to its Source Packet with a wikilink, e.g. `[[sources/SRC-2024-01-05-001]]`.
4. If the wiki does not cover it, say so plainly — do not fabricate citations. Suggest a capture + ingest or a Deep Research loop instead.

**Queries are read-only by default.** Never write to the wiki during a query. Only file the answer as a new **Analysis** page (Page Type `analysis`) when the **user explicitly asks** (e.g. "file this", "save this as a page"). To file: `wiki_ensure_page({ type: "analysis", title: <the question>, sources: [<packet ids>], ... })` and fill the answer/reasoning into the body, keeping the citations. Valuable answers filing back is how exploration compounds — but it is opt-in, not automatic.

### 3. Lint — health-check the wiki

`wiki_lint` (or `/wiki-lint`, append `--fix`) runs mechanical checks and writes `meta/lint-report.md`:

- orphan pages, broken `[[wikilinks]]`, duplicate aliases, coverage gaps (pages citing unknown packets; ingested packets cited by none), and **Inbox drift** (uncaptured or modified files).

`--fix` only auto-captures uncaptured Inbox files — the one safe, deterministic repair. Structural findings (orphans, broken links, contradictions) need human judgment: resolve them by editing `wiki/**`, or file a Review item. Lint is mechanical; it points at problems, the agent resolves them.

### 4. Review — the async human-in-the-loop

During Ingest the agent files items needing human judgment into the **Review Queue** (`meta/review.jsonl`), each with a suggested action (`create_page` | `deep_research` | `skip`) and a pre-built search query. Resolve them at your convenience:

- `wiki_review` (`action=list` to read, `action=resolve` to record a decision + optional note), or
- `/wiki-review` to walk open items one by one interactively.

**Resolving only records the decision** — the queue is a ledger, not an executor. `/wiki-review` (and `wiki_review` resolve) deliberately stay decision-only, keeping the ledger separate from execution. The actions are then carried out separately:

- **`deep_research`** — automated end-to-end by `/wiki-research` (or the `wiki_deep_research` tool): for each open `deep_research` item it runs the item's pre-built query through the configured web-search provider chain, captures each result URL into a Source Packet (idempotent by URL), batch-ingests them, and **resolves the item once at least one packet ingests**. Re-entrant: re-running skips already-captured URLs and already-ingested packets; an item where every packet fails stays open, and items with no query are skipped (recorded, never blocking). Override the top-N per run via the `deepResearchMaxResults` config item or a per-call `maxResults`.
- **`create_page`** — performed in-session by the agent: create the page with `wiki_ensure_page`.
- **`skip`** — closes the item with no action.

## Citation discipline

Citations are the spine of the wiki. Every non-trivial claim on a Wiki Page traces to a Source Packet via a `[[sources/SRC-…]]` wikilink. These wikilinks feed both backlinks and Graph Relevance — sloppy citations degrade recall for every future query.

- Cite the **packet**, not a URL: `[[sources/SRC-2024-01-05-001]]`.
- A page's frontmatter `sources[]` lists the packet ids it draws on (drives the source-overlap signal).
- `[[wikilinks]]` between pages (e.g. `[[concepts/react-hooks]]`) are how cross-references accumulate.

## What you may never edit directly

Raw Sources (`raw/**`) and generated metadata (`meta/**`) are tool-owned. The guardrail blocks direct `write`/`edit` into them. Edit only `wiki/**`; metadata rebuilds itself at end of turn whenever `wiki/**` changes.

## Division of labor with the memory extension

The LLM Wiki and the `memory` extension are **separate tool sets for separate recall intents** — consult the right one, do not duplicate.

- **`memory`** (`memory-*`, `journal-*` tools) is the agent's **autobiographical** state: who the user is, preferences, decisions, corrections, session-scoped facts — small, high-signal deltas that change *behavior*. Recall it **before answering anything that could depend on history**.
- **LLM Wiki** (`wiki_*` tools) is **compiled, source-cited knowledge**: what the documented sources say about a topic, traced to Raw Sources. Recall it when answering **factual, technical, or domain** questions that have been ingested.

Rule of thumb: *"what I know about the user or how I should act"* → memory. *"what the cited sources say about a subject"* → wiki. They never collide — different tools, different stores. When a topic surfaces in conversation, recall memory for personal/contextual shape first, then the wiki for the source-backed substance.
