---
description: Relentless interview that sharpens a plan AND builds the domain model (CONTEXT.md glossary + ADRs) as we go
argument-hint: "<plan-or-design-request>"
---

## 0. Request to grill

$@

If empty, use `ask_user_question` to ask me what I want to plan or design before starting.

Grill me about this plan or design while building the project's domain model. Run the `grilling` and `domain-modeling` skills together:

- **Grilling** — one question at a time, each with your recommended answer; explore the codebase (read, grep, glob) instead of asking what you can find there; don't enact anything until I confirm we've reached a shared understanding.
- **Domain modeling** — sharpen the ubiquitous language as we go: challenge fuzzy or conflicting terms, stress-test relationships with concrete scenarios, cross-reference stated behaviour against the code, capture resolved terms into `CONTEXT.md` inline (not batched), and offer an ADR only when all three hold (hard to reverse, surprising without context, real trade-off).

Load both skills (`skills/grilling/SKILL.md`, `skills/domain-modeling/SKILL.md`) before starting.

## Where docs live

All artifacts for this session go under a single docs directory scoped to the thing being planned or designed.

- If the repo already has a docs directory that matches the current topic (`docs/<slug>/CONTEXT.md` or `docs/<slug>/`), reuse it.
- Otherwise, infer a slug from the request in section 0 (concise English name, lowercase, hyphen-separated, `<= 40` chars, matching `[a-z0-9-]+`). Do **not** ask me for it — summarize what the feature *does*, even when my input is not English.

Everything lands there:

```
docs/<slug>/
├── CONTEXT.md          ← glossary only, no implementation details
└── adr/                ← created lazily when the first ADR is needed
    ├── 0001-*.md
    └── 0002-*.md
```

This overrides the domain-modeling skill's default of a root `CONTEXT.md`. Ignore single-context / `CONTEXT-MAP.md` rules — for this prompt, one scoped directory per plan.

## How to ask questions

Prefer the `ask_user_question` tool over free-form prompts whenever a question has a discrete set of plausible answers. This lets me pick instead of typing, and you can mark your recommended option with "(Recommended)".

Rules:

- **One question at a time.** `ask_user_question` supports multiple questions per call, but for grilling you still ask sequentially — wait for my answer before raising the next issue. Batch at most trivially related clarifications (e.g. naming + file location of the same artifact).
- **Always reserve an escape hatch.** Every question must let me give a custom answer. `ask_user_question` appends a "Type something." row to single-select questions automatically — do not author it yourself, and do not suppress it (e.g. by adding a `preview` to every option) unless you intentionally want to force a choice.
- **Recommend, don't dictate.** Put the option you believe is right first and label it "(Recommended)". If your recommendation depends on something you found in the codebase, say so in its description.
- **Fall back to plain text** when the question is genuinely open-ended (no discrete options), when you need me to explain rationale, or when options would just be noise.

Do not enact the plan until I confirm we have reached a shared understanding.
