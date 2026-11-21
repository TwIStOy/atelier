# Multi-Harness

Sharing this monorepo's assets and capabilities with other coding-agent harnesses (OpenCode, Cursor), under a single source of truth.

## Language

### Sharing architecture

**Harness**:
A coding-agent runtime that discovers skills, prompts, providers, and plugins — Pi, OpenCode, Cursor.
_Avoid_: agent (ambiguous with personas), host, client

**Single Source**:
This repository, the only place shared assets are edited. Other harnesses consume from here; nothing generates second copies.
_Avoid_: source of truth copy, sync target

**Native Discovery**:
A harness finding shared assets through its own built-in discovery paths (e.g. `.agents/skills/`), with no build or generation step.
_Avoid_: sync, compilation, adapter output

### Asset kinds

**Content Asset**:
Harness-agnostic material consumed as-is or referenced from a shell: skill bodies, prompt bodies, prompt resources, personas.
_Avoid_: config (too broad), plugin (wrong kind)

**Per-Harness Shell**:
A tiny harness-native wrapper (Pi prompt, OpenCode command, Cursor skill) whose body points at a shared Prompt Body or Content Asset instead of duplicating it.
_Avoid_: wrapper (too vague), adapter (implies code)

**Prompt Body**:
The shared instruction text of a prompt, stored under `prompts-resource/<name>/` and referenced by every harness's shell. Carries no frontmatter and no shell-specific invocation syntax.
_Avoid_: prompt template (that is the Pi shell form), command body

**Provider Gateway**:
An OpenAI-compatible HTTP endpoint (Toori, Magpie) that any harness consumes through plain provider configuration rather than ported code.
_Avoid_: provider plugin (that is the Pi-specific implementation)

### Capability policy

**Plugin Capability**:
A behavior implemented against one harness's extension API (the Pi packages in this repo), as opposed to Content Assets.
_Avoid_: feature (too broad), extension (that is the packaging unit)

**Built-in Equivalent**:
A target harness's native feature that stands in for a Pi Plugin Capability, preferred over porting.

**Gap Fill**:
Re-implementing a Pi capability in a target harness because no Built-in Equivalent exists and the capability is required there.
_Avoid_: port (ambiguous with content porting)

### Repo and deployment

**Harness Overlay**:
The repo's central `harness/<harness>/` tree holding deploy-only artifacts for each target (OpenCode plugin and command shells, Cursor skill shells). Not auto-discovered inside this repo; consumed only through deployment links.
_Avoid_: dotdir overlay, per-package overlay

**Deployment Link**:
A symlink from a harness's user-level discovery path (`~/.agents/skills/`, `~/.config/opencode/`, `~/.cursor/skills/`) back into this repo, created by the idempotent deploy recipe.
_Avoid_: install, copy, sync

**Stable Path**:
A user-level path (`~/.agents/skills/...`, `~/.agents/prompts-resource/...`) whose target the deploy recipe maintains, so shells and bodies can reference shared assets without machine-specific checkout paths.
_Avoid_: absolute path, hardcoded path
