# Prompts become symmetric shells over shared bodies

Slash commands are not portable across harnesses (Pi prompt templates, OpenCode commands, and Cursor skills have incompatible frontmatter and invocation syntax; prior research shows skills are the only directly portable layer). Instead of porting prompt text into each format or converting everything to skills, every prompt's instruction text moves to `prompts-resource/<name>/` as the Prompt Body, and each harness gets a thin native shell that points at it: Pi `prompts/*.md`, OpenCode `harness/opencode/commands/*.md`, Cursor `harness/cursor/skills/<name>/SKILL.md` with `disable-model-invocation`. Pi and OpenCode shells instruct the agent to read the body via the Stable Path `~/.agents/prompts-resource/<name>/BODY.md` (a deploy-recipe symlink); Cursor shells carry an in-skill `BODY.md` symlink, the agentskills-conventional way to reference skill-relative resources. OpenCode's `@file` command injection was rejected: its path resolution was never documented on the V1 line and V2 removes the feature entirely.

## Considered Options

- Pi prompts stay the body; OpenCode/Cursor shells reference `prompts/*.md` directly — rejected: makes Pi the privileged format and leaves bodies in a Pi-shaped location.
- Convert all prompts to `disable-model-invocation` skills — rejected: gives up per-harness command capabilities (e.g. OpenCode `$ARGUMENTS` handling in the shell) and changes manual invocation paths on Pi.

## Consequences

- Pi prompt invocations pay one extra tool call to read the body, and shell-level template substitution (`$1`, `${1:-default}`) no longer reaches the body: arguments are appended as plain text and bodies are written argument-agnostic.
- Accepted for symmetry: exactly one body per prompt, three shells, no duplicated text.
