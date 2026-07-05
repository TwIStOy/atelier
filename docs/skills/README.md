# Engineering Skills — Usage Guide

A set of skills and one prompt that port and adapt the engineering workflow from
[`mattpocock/skills`](https://github.com/mattpocock/skills) (MIT) to this repo's
pi conventions. They target four failure modes of coding agents: not doing what
you wanted, being too verbose, shipping broken code, and producing a ball of mud.

This doc is the operator's reference — what each one does, how to trigger it,
and how they compose. The per-skill `SKILL.md` files remain the source of truth
the agent loads at runtime; this is the human-facing index.

## Two ways to trigger

| Type | How it fires | Members |
|---|---|---|
| **Skill** (model-invoked) | Talk normally — the agent matches your request against each skill's `description` and loads it automatically. No slash command needed. | `grilling`, `domain-modeling`, `tdd`, `code-review`, `diagnosing-bugs`, `write-a-skill` |
| **Prompt** (user-invoked) | Type `/command` explicitly. Only fires by hand. | `/grill-with-docs` |

Trigger phrasing matches **semantically**, so Chinese or English both work — but
English keywords are the most reliable. When in doubt, name the skill outright:
"do this with the tdd skill".

## The skills

### `grilling` — interrogate a plan before building

- **Triggers**: "stress-test this plan", "grill me", "challenge this design",
  "interrogate this idea", "盘问一下这个方案".
- **When**: you have a fuzzy plan and want to be cross-examined into clarity
  before touching code.
- **Discipline**: one question at a time, each with a recommended answer; the
  agent explores the codebase instead of asking what it can find itself; it does
  not enact the plan until you confirm shared understanding.
- **Stateless**: writes nothing to disk.

### `domain-modeling` — pin down the project's ubiquitous language

- **Triggers**: "pin down this term", "sharpen the domain language", "record an
  architectural decision", "CONTEXT.md", "ADR", "统一术语", "记个架构决策".
- **When**: project vocabulary is slippery, or you're about to make a
  hard-to-reverse decision worth recording.
- **Products**: `CONTEXT.md` (a glossary — opinionated canonical terms with
  `_Avoid_` synonyms, no implementation details) and `docs/adr/NNNN-slug.md`
  (1–3 sentence decision records).
- **Discipline**: terms are captured inline as they resolve (never batched); an
  ADR is offered **only** when all three hold — hard to reverse, surprising
  without context, and the result of a real trade-off.

### `/grill-with-docs` — grill while building the domain model

- **How**: type `/grill-with-docs`.
- **When**: same as `grilling`, but with a codebase — you want the interrogation
  to also persist a shared vocabulary.
- **Mechanics**: a thin prompt that composes the `grilling` and `domain-modeling`
  skills, telling the agent to load both `SKILL.md` files and apply them together.

### `tdd` — test-driven development worth keeping

- **Triggers**: "use TDD for X", "test-first", "red-green-refactor",
  "integration tests", "用 TDD 做 X".
- **When**: building a feature or fixing a bug and you want tests that survive
  refactors.
- **Discipline**:
  1. **Agree seams first** — list the public boundaries under test and confirm
     with the user before writing any test. No test at an unconfirmed seam.
  2. **Red → green** — failing test first, then only enough code to pass.
  3. **Vertical slices** — one test → one implementation → repeat; each test is
     a tracer bullet that responds to what the last cycle taught.
  4. **Refactoring is not part of the loop** — it belongs to the `code-review`
     stage.
- **Anti-patterns it flags**: implementation-coupled (breaks on refactor),
  tautological (passes by construction), horizontal slicing (tests imagined
  behavior). See `skills/tdd/references/{tests,mocking}.md`.

### `code-review` — two-axis parallel review

- **Triggers**: "review since main", "review this branch", "code review",
  "看看这次的改动", "review this PR".
- **When**: a body of changes is done and you want it reviewed systematically.
- **Mechanics**: pins a fixed point (commit/branch/tag/merge-base), then spawns
  **two sub-agents in parallel** via the `subagent` tool —
  - **Standards**: does the diff follow this repo's documented standards
    (`AGENTS.md`, `CODING_STANDARDS.md`, …) plus a fixed 12-smell Fowler
    baseline?
  - **Spec**: does the diff faithfully implement the originating issue/PRD?
  Reports are presented side by side and deliberately **not** merged or reranked.
- **Why two axes**: stops "correct but non-idiomatic" from masking
  "idiomatic but wrong", and vice versa.

### `diagnosing-bugs` — disciplined debugging

- **Triggers**: "debug this", "diagnose X", "this is broken / throwing / failing
  / slow", "调试这个 bug", "排查一下".
- **When**: a hard bug or a performance regression — the kind where staring at
  code doesn't help.
- **Iron rule**: **no hypothesis until a tight, red-capable feedback loop
  exists.** Phase 1 is "the skill" — everything else is mechanical. The agent
  refuses to theorise before it can reproduce the bug with one fast, deterministic
  command that asserts the user's exact symptom.
- **The 6 phases**: build + tighten the loop → reproduce + minimise → hypothesise
  (3–5 ranked, falsifiable) → instrument (one variable at a time, tagged
  `[DEBUG-xxxx]` logs) → fix + regression test at a correct seam → cleanup +
  post-mortem.
- **Human-in-the-loop fallback**: when a human must click, the bundled
  `skills/diagnosing-bugs/scripts/hitl-loop.template.sh` structures the loop.

## Recommended workflows

### Full loop — idea to merge

These five are designed to interlock:

```
/grill-with-docs     interrogate the requirement, write CONTEXT.md + ADRs
       ↓
tdd                  read CONTEXT.md so test names match the domain language;
                     red → green, one vertical slice at a time
       ↓
code-review          review since <branch-point>; two parallel reports
       ↓
refactor             handle the Standards-axis findings here — tdd defers
                     refactoring to this stage on purpose
```

### When something is broken

`diagnosing-bugs` runs a 6-phase loop, but the whole skill collapses to one
iron rule: **no hypothesis until a tight, red-capable feedback loop exists.**

```
1. build + tighten the loop   failing test / curl / replay / harness / …
2. reproduce + minimise       shrink to the smallest scenario that still goes red
3. hypothesise               3–5 ranked, each falsifiable; show the user first
4. instrument                one variable at a time; tagged [DEBUG-xxxx] logs
5. fix + regression test     at a correct seam; no seam → that's the finding
6. cleanup + post-mortem     remove instrumentation; state the cause in the commit
```

### Single-skill snippets

- Just interrogate, no persistence → "grill me" (fires `grilling`, writes nothing).
- Just fix one term → "pin down X" (fires `domain-modeling`).
- Just test one feature → "do X with TDD".
- Just review one change → "review since main".
- Something is broken → "debug this" / "diagnose X" (fires `diagnosing-bugs`).

## Practical notes

- **`CONTEXT.md` is the hub.** `domain-modeling` writes it; `tdd` reads it so
  test and interface names track the project's domain language. Building the
  glossary once pays off in every subsequent test.
- **`tdd` ↔ `code-review` form a closed loop.** `tdd` explicitly defers
  refactoring to the review stage and points at `code-review`. Using only one
  leaves the loop half-open.
- **`code-review` spawns real sub-agents.** You will see two `general-purpose`
  sub-tasks run concurrently with isolated contexts. That separation is the
  point — do not collapse them.
- **`code-review` needs a fixed point.** Give it `review since main`,
  `review since HEAD~5`, `review since <tag>`, etc. If you omit it, the skill
  asks.
- **`diagnosing-bugs` enforces an order.** It will refuse to theorise before a
  tight, red-capable feedback loop exists — if it seems slow to "just guess",
  that is the discipline working. For bugs that need human clicks, it falls back
  to the bundled `skills/diagnosing-bugs/scripts/hitl-loop.template.sh`.
- **Cross-references resolve.** `tdd` points at `code-review`; `grill-with-docs`
  loads `grilling` + `domain-modeling`; `tdd`, `domain-modeling`, and
  `diagnosing-bugs` all read `CONTEXT.md`. All targets exist in this repo.

## Provenance and adaptations

Ported from [`mattpocock/skills`](https://github.com/mattpocock/skills) (MIT).
The source targets Claude Code; the following adaptations were made for pi:

- **User-invoked skills → prompts.** mattpocock's `disable-model-invocation`
  user-invoked skills map to pi's `prompts/` (typed by hand). Model-invoked
  skills map to `skills/` (auto-loaded by description match). Only
  `grill-with-docs` became a prompt; the rest are skills.
- **`/skill-name` cross-invocation → explicit load.** pi skills are not slash
  commands, so `grill-with-docs` names both skills and tells the agent to read
  their `SKILL.md` files.
- **`code-review` sub-agent mechanism.** "two `Agent` tool calls" became a
  single `subagent` call with two entries in its `tasks` array
  (`agent_type: "general-purpose"`), which runs them concurrently with isolated
  contexts.
- **Dropped Matt-specific wiring.** `code-review`'s `/setup-matt-pocock-skills`
  and `docs/agents/issue-tracker.md` references were removed; issue fetching now
  uses `gh issue view <num>`, and `AGENTS.md` was added to the standards sources.
- **Reference files moved under `references/`.** mattpocock keeps them as
  sibling files; this repo's convention is a `references/` subdirectory. Links
  updated accordingly. Filenames kept as upstream (`tests.md`, `mocking.md`,
  `CONTEXT-FORMAT.md`, `ADR-FORMAT.md`) since the repo already mixes casing.
- **`diagnosing-bugs` script paths and a dropped skill ref.** The two
  `hitl-loop.template.sh` references use the full repo path
  (`skills/diagnosing-bugs/scripts/...`) because pi resolves file paths from the
  cwd, not the skill directory. Phase 6's `/improve-codebase-architecture`
  hand-off was generalized to "a dedicated architecture-improvement pass" — that
  skill was not ported (overlaps `code-philosophy` + `design-an-interface`).
- **`writing-great-skills/GLOSSARY.md` was distilled, not ported as a skill.**
  Its vocabulary (leading words, the two invocation loads, completion criteria,
  the five failure modes) lives in `skills/write-a-skill/references/SKILL_VOCABULARY.md`,
  merged into the existing `write-a-skill` skill to avoid overlap.
