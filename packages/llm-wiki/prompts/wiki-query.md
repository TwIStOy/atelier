---
description: Answer a question against the LLM Wiki with source citations (read-only by default; opt-in filing as an Analysis page)
argument-hint: "[question]"
---

# Wiki Query

## Question

$@

If the question is empty, ask the user what they want to know before proceeding.

## Workflow

Run the read-only wiki query workflow described in the bundled **llm-wiki** skill (load `skills/llm-wiki/SKILL.md` if it is not already in context):

1. **Recall.** Call `wiki_recall` with the question (Layered Recall — keyword + Graph Relevance across both the project and personal vaults). Use `wiki_search` instead only when you want a single-vault keyword lookup with no graph expansion.
2. **Read.** `read` the highest-value hits, and the Source Packets they cite (`[[sources/SRC-…]]`), until you have enough grounded material to answer — or until you have confirmed the wiki does not cover it.
3. **Answer.** Give a direct, synthesized answer. **Cite every claim** to its Source Packet as a wikilink, e.g. `[[sources/SRC-2024-01-05-001]]`.

## Read-only by default

A query is **read-only**. Do not create or edit any Wiki Page during the query itself. Keep the answer in the conversation.

Only **file the answer as a new Analysis page** (Page Type `analysis`) when the **user explicitly asks** — e.g. "file this", "save this to the wiki", "add this as a page". When they do, use `wiki_ensure_page` with `type: "analysis"`, set `title` to the question, list the cited packet ids in `sources`, and write the answer and reasoning into the body (keep the `[[sources/SRC-…]]` citations). Do not file on your own initiative.

## If the wiki does not cover it

Say so plainly. Do not fabricate citations or infer beyond what the packets actually say. Offer the next step: capture + ingest a relevant source, or run a Deep Research loop (search the web, `wiki_capture` each result, then ingest). Filing a Review item with a `deep_research` action is the right way to defer this.
