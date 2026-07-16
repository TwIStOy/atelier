---
description: Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one you pick
argument-hint: "[module | subsystem | pain-point]"
---

# Improve Codebase Architecture

## 0. Scope hint

$@

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

This command is _informed_ by the project's domain model and built on a shared design vocabulary (inlined below). Also useful when exploring alternative interfaces: load `skills/design-an-interface/SKILL.md` and use its design-it-twice parallel sub-agent pattern. Domain language lives in `CONTEXT.md`; ADRs in `docs/adr/` (or `docs/<slug>/adr/`) record decisions this command should not re-litigate.

## Architecture vocabulary

Use these terms **exactly** in every suggestion — don't drift into "component," "service," "API," or "boundary."

| Term | Meaning |
|---|---|
| **Module** | Anything with an interface and an implementation. Scale-agnostic: function, class, package, or tier-spanning slice. _Avoid_: unit, component, service. |
| **Interface** | Everything a caller must know to use the module correctly: type signature, invariants, ordering, error modes, config, performance. _Avoid_: API, signature (too narrow). |
| **Implementation** | What's inside a module. Distinct from **Adapter** (role at a seam vs substance inside). |
| **Depth** | Leverage at the interface: behaviour exercised per unit of interface a caller must learn. **Deep** = lots of behaviour behind a small interface; **shallow** = interface nearly as complex as the implementation. |
| **Seam** _(Michael Feathers)_ | A place where you can alter behaviour without editing in that place; the *location* of a module's interface. _Avoid_: boundary. |
| **Adapter** | A concrete thing that satisfies an interface at a seam. Role, not substance. |
| **Leverage** | What callers get from depth: more capability per unit of interface learned. |
| **Locality** | What maintainers get from depth: change, bugs, knowledge, and verification concentrate in one place. |

**Principles to apply:**

- **The deletion test.** Imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam. If you want to test *past* the interface, the module is probably the wrong shape.
- **One adapter means a hypothetical seam. Two adapters means a real one.** Don't introduce a seam unless something actually varies across it.

Also useful: `skills/code-philosophy/SKILL.md` for local coding style (guard clauses, parse-don't-validate) — orthogonal to this vocabulary.

## Process

### 1. Explore

**Scope before you scan — YAGNI.** Deepening a module pays off by making future changes to it easier, so put extra weight on the parts of the codebase that have recently changed. Decide *where* to look before you look:

- If section 0 named a direction — a module, a subsystem, a pain point — take it, and skip the inference below.
- Otherwise, walk back a good stretch of the commit history (`git log --oneline`) to find the codebase's hot spots — the files and areas that keep coming up — and let those paths pull your attention first. If the changes are scattered with no clear hot spot, widen the net.

Read the project's domain glossary (`CONTEXT.md`) and any ADRs in the area you're touching first.

Then use the `subagent` tool with `agent_type=explore` to walk the codebase. Don't follow rigid heuristics — explore organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow** — interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called (no **locality**)?
- Where do tightly-coupled modules leak across their seams?
- Which parts of the codebase are untested, or hard to test through their current interface?

Apply the **deletion test** to anything you suspect is shallow: would deleting it concentrate complexity, or just move it? A "yes, concentrates" is the signal you want.

### 2. Present candidates as an HTML report

Write a self-contained HTML file to the OS temp directory so nothing lands in the repo. Resolve the temp dir from `$TMPDIR`, falling back to `/tmp` (or `%TEMP%` on Windows), and write to `<tmpdir>/architecture-review-<timestamp>.html` so each run gets a fresh file. Open it for the user — `xdg-open <path>` on Linux, `open <path>` on macOS, `start <path>` on Windows — and tell them the absolute path.

The report uses **Tailwind via CDN** for layout and styling, and **Mermaid via CDN** for diagrams where a graph/flow/sequence reliably communicates the structure. Mix Mermaid with hand-crafted CSS/SVG visuals — use Mermaid when relationships are graph-shaped (call graphs, dependencies, sequences), and hand-built divs/SVG when you want something more editorial (mass diagrams, cross-sections, collapse animations). Each candidate gets a **before/after visualisation**. Be visual.

For each candidate, render a card with:

- **Files** — which files/modules are involved
- **Problem** — why the current architecture is causing friction
- **Solution** — plain English description of what would change
- **Benefits** — explained in terms of locality and leverage, and how tests would improve
- **Before / After diagram** — side-by-side, custom-drawn, illustrating the shallowness and the deepening
- **Recommendation strength** — one of `Strong`, `Worth exploring`, `Speculative`, rendered as a badge

End the report with a **Top recommendation** section: which candidate you'd tackle first and why.

**Use CONTEXT.md vocabulary for the domain, and the architecture vocabulary above for the design.** If `CONTEXT.md` defines "Order," talk about "the Order intake module" — not "the FooBarHandler," and not "the Order service."

**ADR conflicts**: if a candidate contradicts an existing ADR, only surface it when the friction is real enough to warrant revisiting the ADR. Mark it clearly in the card (e.g. a warning callout: _"contradicts ADR-0007 — but worth reopening because…"_). Don't list every theoretical refactor an ADR forbids.

See `prompts/resource/improve-codebase-architecture/HTML-REPORT.md` for the full HTML scaffold, diagram patterns, and styling guidance.

Do NOT propose interfaces yet. After the file is written, ask the user: "Which of these would you like to explore?"

### 3. Grilling loop

Once the user picks a candidate, run the `grilling` skill to walk the decision tree with them — constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive. Load `skills/grilling/SKILL.md` first.

Side effects happen inline as decisions crystallize — run the `domain-modeling` skill to keep the domain model current as you go (`skills/domain-modeling/SKILL.md`):

- **Naming a deepened module after a concept not in `CONTEXT.md`?** Add the term to `CONTEXT.md`. Create the file lazily if it doesn't exist.
- **Sharpening a fuzzy term during the conversation?** Update `CONTEXT.md` right there.
- **User rejects the candidate with a load-bearing reason?** Offer an ADR, framed as: _"Want me to record this as an ADR so future architecture reviews don't re-suggest it?"_ Only offer when the reason would actually be needed by a future explorer to avoid re-suggesting the same thing — skip ephemeral reasons ("not worth it right now") and self-evident ones.
- **Want to explore alternative interfaces for the deepened module?** Load `skills/design-an-interface/SKILL.md` and use its design-it-twice parallel sub-agent pattern.
