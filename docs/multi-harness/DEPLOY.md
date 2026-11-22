# Deploying to Other Harnesses

Operational guide for the Harness Overlay (`harness/`) and the deploy recipe. Design decisions: `CONTEXT.md` and ADRs 0001/0002 in this directory.

## Layout

Everything user-facing — skills and User-Invoked Skills alike — lives in `skills/` at the repo root. `harness/` holds only the Magpie OpenCode plugin source:

```
skills/<name>/SKILL.md              # every skill, including former prompts
  └── references/...                # skill resources (brief formats, templates)
harness/opencode/plugins/magpie.ts  # Magpie provider registration + generate_image (opencode2 plugin API)
```

Former prompt commands are User-Invoked Skills: `disable-model-invocation: true` (Pi, Cursor) plus `metadata.opencode/autoinvoke: false` (OpenCode), invoked as `/skill:name` on Pi and `/skill-name` on OpenCode/Cursor. Their resources live in each skill's `references/`; cross-skill references use the Stable Path `~/.agents/skills/<skill>/...`.

## What deploy does

`just deploy-harness` (`scripts/deploy-harness.mjs`) is idempotent and never edits OpenCode's config file:

- `~/.agents/skills/<name>` → this repo's `skills/<name>` (all skills, for Pi/OpenCode/Cursor user-level discovery).
- `$XDG_CONFIG_HOME/opencode/plugins/magpie.ts` → a direct symlink to `harness/opencode/plugins/magpie.ts`. OpenCode auto-loads bare `.ts` files from its plugins directories (opencode2 docs), so there is no build step: the host does a plain dynamic import of the entry, and Bun resolves `@opencode/plugin` from this repo's `node_modules` (module resolution follows the symlink's realpath). Deploy therefore requires `npm install` to have run in this checkout. A retired `magpie.js` bundle link from the earlier bundled layout is pruned when present.
- `~/.cursor/skills/<name>` → this repo's `skills/<name>`, the same links as `~/.agents/skills`.

It also prunes links left by retired layouts — anything pointing into this repo's `harness/` under `~/.cursor/skills` or the OpenCode commands dir, and a `~/.agents/prompts-resource` symlink — without touching any other entry.

Existing links pointing at this checkout are kept, links pointing elsewhere are repointed, and real directories or files at a target path are skipped with a warning (never clobbered). Links are added and updated, never pruned outside the retired-layout cases above — remove a link by hand when a source skill goes away. Skills under the repo's `.agents/skills/` are Project-Local Skills (this repo only) and are not deployed.

## Magpie plugin

`harness/opencode/plugins/magpie.ts` targets the **opencode2 plugin API only** (`Plugin.define` from `@opencode/plugin`). It is self-contained — no config entries:

- **Provider**: on setup it fetches `<baseURL>/models` (10s timeout) and registers the `magpie` provider through `ctx.provider.transform`, with every chat model the gateway advertises, mapped from the same catalog Pi refreshes: `magpie_label` display names, context windows and input limits, output limits, pricing (USD per million tokens), input/output modalities, tool support from `supported_parameters`/`tool_call`, release date from `created_at`, and reasoning-effort variants from `supported_reasoning_levels` (fallback `reasoning_levels`; each variant sends `reasoning_effort` through the openai-compatible package). `package` is `@opencode/ai/providers/openai-compatible`.
- **Tool**: `generate_image` is registered via `ctx.tool.transform` with a JSON-Schema input; generated files are saved in the project directory and returned both as text lines and as `file` content so multimodal models/UI see the image.

Gateway defaults match the Pi package: `http://poi.li-rankine.ts.net:3425` with key `magpie-private`; `MAGPIE_BASE_URL` / `MAGPIE_API_KEY` override them. A failed catalog fetch logs to stderr and registers the provider without models. Startup therefore makes one gateway request; the list is not cached across restarts.

## Caveats

- **opencode2 only**: the plugin needs the 2.x plugin runtime (`@opencode/plugin`). The pre-2.x line (`@opencode-ai/plugin`, V1 hooks) is deliberately unsupported. Nothing links or edits `opencode.json`.
- **Skill invocation syntax differs per harness**: Pi uses `/skill:name`, OpenCode and Cursor use `/skill-name`. Skill bodies say "the text typed alongside the invocation" and stay syntax-neutral.
- **Pi hides User-Invoked Skills from the model**: `disable-model-invocation: true` keeps them out of automatic selection; the `enableSkillCommands` setting controls whether they appear in interactive command discovery, and manually entered `/skill:name` always works.
- **Deploy from the main checkout**: `magpie.ts` resolves `@opencode/plugin` through the linked checkout's `node_modules` at load time. Deploying from a throwaway worktree breaks plugin loading once that worktree and its dependencies are deleted.
- **Plugin reload**: OpenCode caches loaded plugin modules by path — restart OpenCode (or touch the linked `magpie.ts` under a watched config directory) after deploy changes before verifying.
- **Cursor cloud sync does not follow symlinks** (community-reported): the linked skills work locally but do not sync to Cursor Cloud Agents. Copy instead of linking if that matters.
- **Cursor IDE symlink discovery** had a known bug (the CLI follows symlinks since June 2026); if skills do not appear, copy the directories.
