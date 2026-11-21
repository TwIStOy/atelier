# Deploying to Other Harnesses

Operational guide for the Harness Overlay (`harness/`) and the deploy recipe. Design decisions: `CONTEXT.md` and ADRs 0001/0002 in this directory.

## Layout

```
harness/
├── opencode/
│   ├── commands/<name>.md        # OpenCode command shells (thin, point at the shared BODY)
│   ├── plugins/magpie.ts         # generate_image tool for the Magpie gateway (V1 plugin API)
│   └── provider-magpie.json      # provider.magpie config snippet merged into opencode.json
└── cursor/
    └── skills/<name>/            # Cursor skill shells (disable-model-invocation)
        ├── SKILL.md
        └── BODY.md -> ../../../../prompts-resource/<name>/BODY.md
```

Prompt instruction text (the Prompt Body) lives in `prompts-resource/<name>/BODY.md` at the repo root — one body per prompt, three shells (Pi `prompts/`, OpenCode `harness/opencode/commands/`, Cursor `harness/cursor/skills/`). Pi and OpenCode shells reference the body through the Stable Path `~/.agents/prompts-resource/<name>/BODY.md`, a symlink the deploy script maintains, so no machine-specific path is written into any repo file. Cursor shells instead carry an in-skill `BODY.md` symlink, following the agentskills convention of skill-relative resources.

## What deploy does

`just deploy-harness` (`scripts/deploy-harness.mjs`) is idempotent:

- `~/.agents/skills/<name>` → this repo's `.agents/skills/<name>` (all skills, for Pi/OpenCode/Cursor user-level discovery).
- `~/.agents/prompts-resource` → this repo's `prompts-resource/`.
- `$XDG_CONFIG_HOME/opencode/commands/<name>.md` → `harness/opencode/commands/<name>.md`.
- `$XDG_CONFIG_HOME/opencode/plugins/magpie.js` — built from `harness/opencode/plugins/magpie.ts` with `bun build --target=bun` (the bundle is a build artifact; the source here is the single source).
- `$XDG_CONFIG_HOME/opencode/opencode.json` — merges `provider.magpie` from `harness/opencode/provider-magpie.json` only when the key is absent; existing values are never overwritten.
- `~/.cursor/skills/<name>` → `harness/cursor/skills/<name>`.

Existing links pointing at this checkout are kept, links pointing elsewhere are repointed, and real directories or files at a target path are skipped with a warning (never clobbered). A failed plugin build fails the deploy after the other steps complete.

## Magpie configuration

`provider-magpie.json` and the plugin default to the same LAN gateway the Pi package ships (`http://100.65.0.3:3425`, key `magpie-private`). Overrides:

- **Image tool**: set `MAGPIE_BASE_URL` / `MAGPIE_API_KEY` in the environment OpenCode runs in.
- **Provider**: edit `provider.magpie` in the merged `opencode.json` — e.g. `"apiKey": "{env:MAGPIE_API_KEY}"`. The deploy merge never touches an existing value.
- **Model list**: static (the three routing groups mirroring the Pi settings); edit the snippet or the merged config and re-run deploy. Pi keeps the dynamic `/v1/models` refresh; OpenCode does not.

## Caveats

- **OpenCode version**: written for the installed 1.19.x line (V1 function-style plugin API, `provider` config key, `@ai-sdk/openai-compatible` npm packages). OpenCode V2 renames these (`Plugin.define`, `providers` plural, `@opencode/ai/providers/openai-compatible`); the plugin and snippet need adjusting on upgrade.
- **`@file` command injection is not used**: V1 never documented its path resolution and V2 removes the feature entirely, so OpenCode shells instruct the agent to read the body via the Stable Path instead.
- **Cursor cloud sync does not follow symlinks** (community-reported): the linked skills work locally but do not sync to Cursor Cloud Agents. Copy instead of linking if that matters.
- **Cursor IDE symlink discovery** had a known bug (the CLI follows symlinks since June 2026); if skills do not appear, copy the directories.
