# Prompts become user-invoke-only skills

Slash commands are not portable across harnesses (Pi prompt templates, OpenCode commands, and Cursor skills have incompatible frontmatter and invocation syntax). The first design (superseded the same day) kept per-harness shells over shared `prompts-resource/<name>/BODY.md` bodies. The landed design is simpler: every former prompt becomes a skill under `skills/<name>/SKILL.md` with `disable-model-invocation: true` (plus `metadata.opencode/autoinvoke: false`, which OpenCode honors over the shared flag). User-invoked skills ride the same deploy links as every other skill — `~/.agents/skills/` for Pi and OpenCode, `~/.cursor/skills/` for Cursor — so the three harnesses get identical entries, invoked as `/skill:name` on Pi and `/skill-name` on OpenCode/Cursor. Skill resources (brief formats, templates) live in each skill's `references/`, per the agentskills convention.

## Considered Options

- Per-harness shells over a shared body (the superseded design) — rejected: three wrappers per command, a `~/.agents/prompts-resource` stable path to maintain, and no command mechanism on Cursor at all.
- Converting to model-invoked skills — rejected: these are user-directed workflows; auto-triggering them from a description match would fire on ordinary conversation.

## Consequences

- Invocation arguments are plain text typed alongside the invocation; bodies are written argument-agnostic (no `$1`/`${1:-default}` template substitution — that was Pi-shell-only).
- Cross-references from a body to another skill use the `~/.agents/skills/<skill>/...` stable path; references to a skill's own files are relative `references/...` paths.
- The Pi `pi.prompts` manifest key is gone; all former prompts are registered in `pi.skills` and hidden from the model by the frontmatter flag.
