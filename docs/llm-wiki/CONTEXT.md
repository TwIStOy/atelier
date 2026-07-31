# LLM Wiki

A pi extension that builds and maintains a persistent, interlinked markdown wiki from curated sources, following Karpathy's LLM Wiki pattern. Knowledge is compiled once and kept current, not re-derived per query.

## Language

**LLM Wiki**:
A persistent, compounding markdown knowledge base maintained by the LLM between the user and the raw sources. Cross-references, contradictions, and synthesis accumulate instead of being re-derived on every query.
_Avoid_: RAG, knowledge base (unqualified), notes

**Raw Source**:
An immutable input document (article, paper, pasted text) that the LLM reads but never modifies. The source of truth.
_Avoid_: upload, document, file

**Wiki Page**:
A markdown page in the wiki layer, written and maintained by the LLM. Carries YAML frontmatter and `[[wikilink]]` cross-references; Obsidian-compatible.
_Avoid_: note, document

**Schema**:
The operating-manual document that tells the LLM the wiki's structure, conventions, and workflows. Structural rules, co-evolved by user and LLM.
_Avoid_: config, settings, prompt

**Purpose**:
The directional-intent document (`purpose.md`) stating why the wiki exists: goals, key questions, scope, evolving thesis. Read during every ingest and query. Distinct from Schema: Schema is structural rules, Purpose is intent.
_Avoid_: about, intro, readme

**Source Packet**:
The immutable capture unit for one Raw Source: a `SRC-YYYY-MM-DD-NNN/` directory holding a manifest (origin metadata, including origin path and content hash for local files), the original artifact, and a normalized `extracted.md`.
_Avoid_: upload, attachment

**Inbox**:
The directory the user drops new source files into. Scanned to discover un-captured files (new path) and modified originals (changed hash). Configurable; defaults to a vault-internal directory.
_Avoid_: watch folder, dropbox

**Ingest**:
The operation that integrates a Raw Source into the wiki: analyze, then generate/update Wiki Pages with citations. Runs as two sequential LLM steps (analysis, then generation), in one of two modes: **Interactive** (in the main conversation, user involved) or **Batch** (background side-calls, unattended).
_Avoid_: import, index, embed

**Query**:
The operation that answers a question against the wiki with citations. Valuable answers may be filed back into the wiki as new pages, so exploration compounds.
_Avoid_: search, ask, RAG query

**Lint**:
The operation that health-checks the wiki: contradictions, stale claims, orphan pages, missing cross-references, coverage gaps.
_Avoid_: validate, check

**Review Queue**:
The async human-in-the-loop mechanism. During Ingest the LLM files items needing human judgment (with predefined action types and pre-generated search queries); the user resolves them at their convenience.
_Avoid_: todo, task list, approval

**Deep Research**:
Gap-driven multi-query web search whose findings are synthesized into a Wiki Page and auto-ingested into the wiki.
_Avoid_: web search, browsing

**Vault**:
A rooted directory holding one wiki: Raw Sources, Wiki Pages, Schema, Purpose, and generated metadata.
_Avoid_: project, notebook

**Personal Vault**:
The always-active Vault at `~/.llm-wiki/`. Knowledge compounds across all sessions regardless of project.
_Avoid_: global wiki, default vault

**Project Vault**:
The opt-in Vault at `<project>/.llm-wiki/`, discovered by walking up from the current working directory.
_Avoid_: local wiki

**Layered Recall**:
Recall that searches the Personal Vault and the current Project Vault together and merges the results.
_Avoid_: federated search

**Page Type**:
The classification of a Wiki Page: Source (what one source says), Concept (recurring idea), Entity (person/org/product/paper), Synthesis (cross-source thesis), Analysis (a filed answer from a Query). Drives templates and the type-affinity signal of Graph Relevance.
_Avoid_: category, tag

**Graph Relevance**:
The local four-signal relevance model over the wikilink graph (direct link, source overlap, Adamic-Adar, type affinity) used to expand recall beyond direct search hits.
_Avoid_: knowledge graph (unqualified), embedding similarity
