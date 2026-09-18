---
description: Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one you pick
argument-hint: "[module | subsystem | pain-point]"
---

# Improve Codebase Architecture

## 0. Scope hint

$@

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

This command is _informed_ by the project's domain model and built on a shared design vocabulary. Load `skills/codebase-design/SKILL.md` first and use its terms **exactly** in every suggestion — **module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, **locality** — never drifting into "component," "service," "API," or "boundary." When exploring alternative interfaces, use its design-it-twice parallel sub-agent pattern (`skills/codebase-design/references/DESIGN-IT-TWICE.md`). Domain language lives in `CONTEXT.md`; ADRs in `docs/adr/` (or `docs/<slug>/adr/`) record decisions this command should not re-litigate.

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

Write the report in Chinese — see HTML-REPORT.md for the language rules and the glossary's fixed Chinese renderings. Keep technical tokens (file paths, identifiers, commands) verbatim.

The report is a self-contained HTML file that never lands in the repo: resolve the temp dir from `$TMPDIR`, falling back to `/tmp`, and create a fresh directory `<tmpdir>/architecture-review-<timestamp>/` holding a single `index.html`. The directory must contain only the report — on non-macOS machines it gets served over HTTP.

Deliver it:

- Detect the OS with `uname -s`. On `Darwin` (macOS) the user is local: run `open <dir>/index.html` and tell them the absolute path.
- Otherwise the user reads the report remotely from their Mac. Start an HTTP server bound to `0.0.0.0`, detached so it outlives this session:

  ```bash
  nohup python3 -u -m http.server 0 --bind 0.0.0.0 --directory <dir> > <tmpdir>/architecture-review-<timestamp>.log 2>&1 &
  ```

  Port `0` makes the OS pick a free port; the unbuffered banner in the log file names it (`Serving HTTP on 0.0.0.0 port <N>`). Then give the user one clickable URL per IPv4 address the host has (`ip -4 -brief addr show scope global`) — LAN, Tailscale (`100.64.0.0/10`), and public alike — so they can reach it however their Mac is connected, and mention the server PID so they can stop it later.

The report uses **Tailwind via CDN** for layout and styling, and **Mermaid via CDN** for diagrams where a graph/flow/sequence reliably communicates the structure. Mix Mermaid with hand-crafted CSS/SVG visuals — use Mermaid when relationships are graph-shaped (call graphs, dependencies, sequences), and hand-built divs/SVG when you want something more editorial (mass diagrams, cross-sections, collapse animations). Each candidate gets a **before/after visualisation**. Be visual.

For each candidate, render a card with:

- **Files** — which files/modules are involved
- **Problem** — why the current architecture is causing friction
- **Solution** — plain Chinese description of what would change
- **Benefits** — explained in terms of locality and leverage, and how tests would improve
- **Before / After diagram** — side-by-side, custom-drawn, illustrating the shallowness and the deepening
- **Recommendation strength** — one of 「强烈推荐」, 「值得探索」, 「试探性」, rendered as a badge

End the report with a **Top recommendation** section (heading 「首选建议」): which candidate you'd tackle first and why.

**Use CONTEXT.md vocabulary for the domain, and the `codebase-design` vocabulary for the design.** If `CONTEXT.md` defines "Order," talk about "the Order intake module" — not "the FooBarHandler," and not "the Order service."

**ADR conflicts**: if a candidate contradicts an existing ADR, only surface it when the friction is real enough to warrant revisiting the ADR. Mark it clearly in the card (e.g. a warning callout: 「与 ADR-0007 冲突——但值得重开，因为……」). Don't list every theoretical refactor an ADR forbids.

See `prompts-resource/improve-codebase-architecture/HTML-REPORT.md` for the full HTML scaffold, diagram patterns, and styling guidance.

Do NOT propose interfaces yet. After the report is delivered, ask the user, in Chinese: 「想深入探讨哪一个?」

### 3. Grilling loop

Once the user picks a candidate, run the `grilling` skill to walk the decision tree with them — constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive. Load `skills/grilling/SKILL.md` first.

Side effects happen inline as decisions crystallize — run the `domain-modeling` skill to keep the domain model current as you go (`skills/domain-modeling/SKILL.md`):

- **Naming a deepened module after a concept not in `CONTEXT.md`?** Add the term to `CONTEXT.md`. Create the file lazily if it doesn't exist.
- **Sharpening a fuzzy term during the conversation?** Update `CONTEXT.md` right there.
- **User rejects the candidate with a load-bearing reason?** Offer an ADR, framed as: _"Want me to record this as an ADR so future architecture reviews don't re-suggest it?"_ Only offer when the reason would actually be needed by a future explorer to avoid re-suggesting the same thing — skip ephemeral reasons ("not worth it right now") and self-evident ones.
- **Want to explore alternative interfaces for the deepened module?** Load `skills/codebase-design/references/DESIGN-IT-TWICE.md` and use its design-it-twice parallel sub-agent pattern.
