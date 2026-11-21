# Multi-Harness

Sharing this monorepo's assets and capabilities with other coding-agent harnesses (OpenCode, Cursor), under a single source of truth.

## Language

### Sharing architecture

**Harness**:
A coding-agent runtime that discovers skills, providers, and plugins — Pi, OpenCode, Cursor.
_Avoid_: agent (ambiguous with personas), host, client

**Single Source**:
This repository, the only place shared assets are edited. Other harnesses consume from here; nothing generates second copies.
_Avoid_: source of truth copy, sync target

**Native Discovery**:
A harness finding shared assets through its own built-in discovery paths (e.g. `~/.agents/skills/`), with no build or generation step.
_Avoid_: sync, compilation, adapter output

### Asset kinds

**Content Asset**:
Harness-agnostic material consumed as-is: skill bodies, skill references, personas.
_Avoid_: config (too broad), plugin (wrong kind)

**Repo Skill**:
A skill under `skills/`, shipped with the pi package and deployed to `~/.agents/skills/` for every project.
_Avoid_: shared skill (vague), global skill

**Project-Local Skill**:
A skill under `.agents/skills/` in this repo, discovered only inside this project (e.g. `pi-self-extension`) and never deployed.
_Avoid_: repo skill (that is the deployed one)

**User-Invoked Skill**:
A Repo Skill with `disable-model-invocation: true` that fires only when the human names it — the successor of the old prompt commands. Former prompts live here with their resources in `references/`.
_Avoid_: prompt, command, shell

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
The repo's central `harness/<harness>/` tree holding deploy-only build artifacts (the OpenCode Magpie plugin). Not auto-discovered inside this repo; consumed only through deployment links.
_Avoid_: dotdir overlay, per-package overlay

**Deployment Link**:
A symlink from a harness's user-level discovery path (`~/.agents/skills/`, `~/.config/opencode/plugins/`, `~/.cursor/skills/`) back into this repo, created by the idempotent deploy recipe.
_Avoid_: install, copy, sync

**Stable Path**:
A user-level path (`~/.agents/skills/<skill>/...`) whose target the deploy recipe maintains, so skill bodies can reference shared assets without machine-specific checkout paths.
_Avoid_: absolute path, hardcoded path
