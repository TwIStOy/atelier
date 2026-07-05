---
description: Relentless interview that sharpens a plan AND builds the domain model (CONTEXT.md glossary + ADRs) as we go
---

Grill me about this plan or design while building the project's domain model. Run the `grilling` and `domain-modeling` skills together:

- **Grilling** — one question at a time, each with your recommended answer; explore the codebase (read, grep, glob) instead of asking what you can find there; don't enact anything until I confirm we've reached a shared understanding.
- **Domain modeling** — sharpen the ubiquitous language as we go: challenge fuzzy or conflicting terms, stress-test relationships with concrete scenarios, cross-reference stated behaviour against the code, capture resolved terms into `CONTEXT.md` inline (not batched), and offer an ADR only when all three hold (hard to reverse, surprising without context, real trade-off).

Load both skills (`skills/grilling/SKILL.md`, `skills/domain-modeling/SKILL.md`) before starting.
