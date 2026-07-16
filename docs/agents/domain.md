# Domain Docs

How engineering prompts and skills should consume this repo's domain documentation when exploring the codebase.

This is a **multi-context** monorepo — a collection of independent `pi` extensions under `packages/*`. Each package (extension) is its own context, with shared conventions and shared infrastructure (`packages/common`). The domain docs reflect that: a root map plus per-context `CONTEXT.md` files.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — it points at one `CONTEXT.md` per context (one per extension, plus shared/cross-cutting topics). Read each one relevant to the topic.
- **`docs/adr/`** — system-wide ADRs (decisions that span the whole monorepo: build, tooling, shared conventions).
- **`docs/<context>/adr/`** — context-specific decisions (e.g. `docs/goal/adr/`, `docs/herdr/adr/`). Read the ADRs for the package(s) you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Multi-context layout (this repo). All docs live under the repo-root `docs/` directory, organized by topic — this repo's existing convention. Do **not** create per-package `docs/` directories under `packages/`.

```
/
├── CONTEXT-MAP.md                     ← points to per-context CONTEXT.md
├── docs/
│   ├── adr/                           ← system-wide (cross-package) decisions
│   ├── goal/
│   │   ├── CONTEXT.md                 ← the `goal` extension's domain context
│   │   └── adr/                       ← goal-specific decisions
│   └── herdr/
│       ├── CONTEXT.md
│       └── adr/
└── packages/
    └── goal/                          ← code lives here, docs do not
```

`CONTEXT-MAP.md` at the root lists each context and links to its `docs/<context>/CONTEXT.md`. A `CONTEXT.md` holds that context's ubiquitous language (glossary) and may link out to its `adr/`.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_

Check both the system-wide `docs/adr/` and the context-specific `docs/<context>/adr/` — a context decision may legitimately refine or override a system-wide one, and that relationship should be stated explicitly, not implied.
