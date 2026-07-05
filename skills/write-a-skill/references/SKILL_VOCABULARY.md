# Skill Vocabulary & Qualities

The concepts behind a great skill. The root virtue is **predictability**: a skill wrings a deterministic _process_ (not identical output) out of a stochastic model. Every lever below serves it.

Read this when refining an existing skill or diagnosing why one misbehaves, not when scaffolding a first draft (the main SKILL.md covers that).

## Invocation and the two loads

Every skill pays exactly one of two costs — pick deliberately.

- **Model-invoked** (this repo: lives in `skills/`, has a `description`) — the agent can fire it on its own and other skills can reach it. Pays **context load**: the description sits in the system prompt every turn, spending tokens and attention. Keep only when the agent must reach it without a human nudge.
- **User-invoked** (this repo: lives in `prompts/`) — only the human triggers it by name. Pays **cognitive load**: the human must remember it exists and when to reach for it. Zero context load. Use when it never fires except by hand.

When user-invoked prompts multiply past what you can hold, add a **router** prompt that names the others and when to use each — one thing to remember instead of many.

## Leading words

A **leading word** (Leitwort) is a compact concept already living in the model's pretraining that the agent thinks with while running the skill. Repeated as a token, never as a sentence, it recruits priors the model already holds and anchors a whole region of behaviour in the fewest tokens: _tight_ (for a fast deterministic loop), _red_ (a binary observable gate), _fog of war_, _tracer bullets_.

It serves predictability twice: in the **body** it anchors execution (same behaviour every time the concept appears); in the **description** it anchors invocation (the same word in your prompts, docs, and code links them to the skill and makes it fire more reliably).

Prefer an existing pretrained word; a coined word buys nothing without a definition. Hunt for restatements to collapse — "fast, deterministic, low-overhead" → _tight_; a fuzzy gate → _red_. A leading word too weak to beat the model's default is a **no-op** (below) — reach for a stronger word, not a different technique.

## Information hierarchy

Skill content sits on one ladder, ranked by how immediately the agent needs it:

1. **Step** — an ordered action in SKILL.md. Primary tier. Each ends on a **completion criterion**.
2. **In-file reference** — a definition, rule, or fact consulted on demand. Often a legitimately flat peer-set (every rule of a review on one rung).
3. **Disclosed reference** — pushed behind a context pointer into `references/`, loaded only when the pointer fires.

**Progressive disclosure** is the move down the ladder so the top stays legible. Push too little and the top bloats; push too much and you hide material the agent needs. **Branching** is the cleanest disclosure test: inline what every branch needs, disclose what only some branches reach. A pointer's _wording_, not its target, decides when and how reliably the agent reaches the material — a must-have target behind a weak pointer is a variance bug; sharpen the wording first, inline only if that fails.

**Co-location** is the within-file companion: keep a concept's definition, rules, and caveats under one heading so reading one part brings its neighbours.

## Completion criteria and legwork

A **completion criterion** tells the agent when a unit is done. Two axes make it a lever:

- **Clarity** — can the agent tell done from not-done? A vague bound ("understanding reached") invites premature completion.
- **Demand** — how much it requires. "Every modified model accounted for" forces thorough work; "produce a change list" does not.

**Legwork** is the within-step digging the agent does (reading files, exploring, digging up what it needs) rather than offloading to the user. Never written as its own step; raised by a demanding criterion or a leading word like _comprehensive_ / _relentless_. Goes thin when demand is missing or a step rushes.

## Failure modes

Diagnostic toolkit — use when a skill misbehaves.

- **Premature completion** — ending a step before it's genuinely done because attention slips to _being done_. A between-steps failure. Defence, in order: sharpen the completion criterion first (cheap, local); only if it is irreducibly fuzzy _and_ you observe the rush, split the sequence so the later steps are out of view.
- **No-op** — an instruction the model already follows by default, so you pay load to say nothing. Test sentence by sentence: does this change behaviour versus the default? If not, delete the whole sentence, don't trim it. Be aggressive.
- **Duplication** — the same meaning in more than one place. Costs maintenance (change one, must change the rest), tokens, and inflates a meaning's prominence past its real rank.
- **Sediment** — stale layers that settle because adding feels safe and removing feels risky. The default fate of any skill without a pruning discipline.
- **Sprawl** — simply too long, even when every line is live and unique. Hurts readability, maintainability, and tokens. Cure is the ladder: disclose reference behind pointers, split by branch or sequence.

Keep each meaning in a **single source of truth**: one authoritative place, so a behaviour change is a one-place edit. Check every line for **relevance** — does it still bear on what the skill does?
