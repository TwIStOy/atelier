---
description: Configure this repo for the engineering prompts/skills — issue tracker, triage labels, and domain doc layout. Run once before first use
argument-hint: "[reconfigure]"
---

# Setup Agent Repo Context

## 0. Request

$@

Scaffold the per-repo configuration that the engineering prompts and skills assume:

- **Issue tracker** — where issues live (GitHub by default; GitLab and local markdown are also supported out of the box)
- **Triage labels** — the strings used for the five canonical triage roles
- **Domain docs** — where `CONTEXT.md` and ADRs live, and the consumer rules for reading them

This is a prompt-driven setup, not a deterministic script. Explore, present what you found, confirm with the user, then write.

If section 0 contains `reconfigure` (or the user asks to restart), treat existing `docs/agents/*.md` as drafts to rewrite rather than as already-done.

## Seed templates

Load these before writing; they are starting points for the files under `docs/agents/`:

- `prompts-resource/setup-agent-repo-context/issue-tracker-github.md`
- `prompts-resource/setup-agent-repo-context/issue-tracker-gitlab.md`
- `prompts-resource/setup-agent-repo-context/issue-tracker-local.md`
- `prompts-resource/setup-agent-repo-context/triage-labels.md`
- `prompts-resource/setup-agent-repo-context/domain.md`

## Process

### 1. Explore

Look at the current repo to understand its starting state. Read whatever exists; don't assume:

- `git remote -v` and `.git/config` — is this a GitHub / GitLab repo? Which one?
- `AGENTS.md` and `CLAUDE.md` at the repo root — does either exist? Is there already an `## Agent skills` section in either?
- `CONTEXT.md` and `CONTEXT-MAP.md` at the repo root
- `docs/adr/` and any `src/*/docs/adr/` directories
- `docs/agents/` — does this prompt's prior output already exist?
- `.scratch/` — sign that a local-markdown issue tracker convention is already in use
- Is the `/triage` prompt available? (look for `prompts/triage.md` in this package, project, or global pi prompts, or for a skill/prompt named `triage` among available commands.) This decides whether Section B runs at all.
- Monorepo signals — a `pnpm-workspace.yaml`, a `workspaces` field in `package.json`, or a populated `packages/*` with its own `src/`. Present only in a genuinely large multi-package repo; their absence means single-context, which is almost every repo.

### 2. Present findings and ask

Summarise what's present and what's missing. Then take the sections in order — one section, one answer, then the next.

Prefer the `ask_user_question` tool for each section (one question at a time). Lead each section with the recommended answer so the user can accept it in a word. Give a one-line explainer only when the choice genuinely branches; skip the section entirely when exploration already settled it (Section B when `/triage` isn't available, Section C when there's no monorepo).

**Section A — Issue tracker.**

> Explainer: The "issue tracker" is where issues live for this repo. Prompts like `/to-tickets`, `/triage`, `/to-spec`, and `/implement` read from and write to it — they need to know whether to call `gh issue create`, write a markdown file under `.scratch/`, or follow some other workflow you describe. Pick the place you actually track work for this repo.

Default posture: these prompts were designed for GitHub. If a `git remote` points at GitHub, propose that. If a `git remote` points at GitLab (`gitlab.com` or a self-hosted host), propose GitLab. Otherwise (or if the user prefers), offer:

- **GitHub** — issues live in the repo's GitHub Issues (uses the `gh` CLI)
- **GitLab** — issues live in the repo's GitLab Issues (uses the [`glab`](https://gitlab.com/gitlab-org/cli) CLI)
- **Local markdown** — issues live as files under `.scratch/<feature>/` in this repo (good for solo projects or repos without a remote)
- **Other** (Jira, Linear, etc.) — ask the user to describe the workflow in one paragraph; the setup will record it as freeform prose

Record the choice in `docs/agents/issue-tracker.md`. The GitHub and GitLab templates carry a "PRs/MRs as a request surface" flag, defaulted **off** — leave it off and don't raise it; a user who wants external PRs/MRs in the triage queue can flip the flag in the file later.

**Section B — Triage label vocabulary.** Skip this section entirely if the `/triage` prompt isn't available (exploration told you) — an unavailable prompt needs no labels.

If it is available, ask exactly one question:

> Do you want to keep the default triage labels? (recommended: **yes**)

The defaults are the five canonical roles, each label string equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. On **yes**, write them as-is. Only if the user says no — usually because their tracker already uses other names (e.g. `bug:triage` for `needs-triage`) — collect the overrides so `/triage` applies existing labels instead of creating duplicates.

**Section C — Domain docs.** Default to **single-context** — one `CONTEXT.md` + `docs/adr/` at the repo root. This fits almost every repo; write it without asking.

Offer **multi-context** — a root `CONTEXT-MAP.md` pointing to per-context `CONTEXT.md` files — only when exploration found monorepo signals. Then confirm which layout they want.

### 3. Confirm and edit

Show the user a draft of:

- The `## Agent skills` block to add to whichever of `AGENTS.md` / `CLAUDE.md` is being edited (see step 4 for selection rules)
- The contents of `docs/agents/issue-tracker.md`, `docs/agents/domain.md`, and `docs/agents/triage-labels.md` (the last only when `/triage` is available)

Let them edit before writing.

### 4. Write

**Pick the file to edit** (pi convention: prefer `AGENTS.md`):

- If `AGENTS.md` exists, edit it.
- Else if `CLAUDE.md` exists, edit it.
- If neither exists, ask the user which one to create — don't pick for them. Prefer recommending `AGENTS.md`.

Never create `CLAUDE.md` when `AGENTS.md` already exists (or vice versa) — always edit the one that's already there.

If an `## Agent skills` block already exists in the chosen file, update its contents in-place rather than appending a duplicate. Don't overwrite user edits to the surrounding sections.

The block:

```markdown
## Agent skills

### Issue tracker

[one-line summary of where issues are tracked]. See `docs/agents/issue-tracker.md`.

### Triage labels

[one-line summary of the label vocabulary]. See `docs/agents/triage-labels.md`.

### Domain docs

[one-line summary of layout — "single-context" or "multi-context"]. See `docs/agents/domain.md`.
```

Include the `### Triage labels` sub-block, and write `docs/agents/triage-labels.md`, only when `/triage` is available and Section B ran. When it isn't, both are omitted.

Then write the docs files using the seed templates listed above as a starting point:

- GitHub → copy from `issue-tracker-github.md` into `docs/agents/issue-tracker.md`
- GitLab → copy from `issue-tracker-gitlab.md`
- Local markdown → copy from `issue-tracker-local.md`
- Triage labels → copy from `triage-labels.md` (only if `/triage` is available)
- Domain docs → copy from `domain.md` into `docs/agents/domain.md`

For "other" issue trackers, write `docs/agents/issue-tracker.md` from scratch using the user's description.

### 5. Done

Tell the user the setup is complete and which engineering prompts/skills will now read from these files (`/triage`, `/to-spec`, `/to-tickets`, `/implement`, `/improve-codebase-architecture`, `domain-modeling`, `tdd`, `code-review`, `diagnosing-bugs`). Mention they can edit `docs/agents/*.md` directly later — re-running this prompt (`/setup-agent-repo-context reconfigure`) is only necessary if they want to switch issue trackers or restart from scratch.
