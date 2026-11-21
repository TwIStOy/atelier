# Single source with native discovery for multi-harness sharing

Pi's skills, prompts, and provider gateways in this monorepo are useful in other harnesses (first targets: OpenCode, Cursor). Rather than generating per-harness copies or spinning up a separate shared-config repo, this repo stays the single source of truth: each harness consumes shared assets through its own built-in discovery paths (`.agents/skills/`, command/skill shells), and user-level reach comes from an idempotent symlink deploy recipe. Target-harness code artifacts (OpenCode plugin, command shells, Cursor skill shells) live in one central `harness/<harness>/` overlay directory instead of per-package spreads or auto-discovered dotdirs, so nothing is discovered inside this repo by accident.

## Considered Options

- Adapter/generator compiling assets into each harness's format — rejected: second copies drift, build step on every edit.
- Separate shared-config repo consumed by Pi too — rejected: splits the source of truth away from where Pi extensions are maintained.
- Repo-native dotdirs (`.opencode/`, `.cursor/`) for dogfooding — rejected: accidental discovery inside this repo; a central overlay keeps deploy-only artifacts visibly separate.

## Consequences

- Skills stay in `skills/`; the `pi.skills` manifest keeps pointing at them, and other harnesses reach the same files through the user-level `~/.agents/skills` Deployment Links instead of any in-repo `.agents` layer.
- No in-repo dogfooding of OpenCode/Cursor behavior; verification happens after deploying links.
- The deploy recipe is symlinks plus exactly two non-link steps, both for the magpie Gap Fill: building `plugins/magpie.js` from source with `bun build` (a build artifact, not a copy of an asset) and a merge-guarded `provider.magpie` insertion into `opencode.json` that never overwrites an existing value.
- Plugin capabilities are deliberately not ported: target harnesses' built-in equivalents are preferred, with Gap Fills only where required (first and only first-phase Gap Fill: magpie as an OpenCode plugin; toori and Cursor providers untouched).
