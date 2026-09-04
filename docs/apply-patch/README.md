# apply-patch

Ported from [`code-yeongyu/pi-apply-patch`](https://github.com/code-yeongyu/pi-apply-patch) (MIT), which itself extracts the Codex `apply_patch` tool from senpi-mono. The patch grammar and tool description mirror OpenAI Codex.

## What it does

Registers one LLM-callable tool, `apply_patch`, that applies Codex patch envelopes (add / update / delete / move) with Node path resolution. While an OpenAI GPT-family model is active, the extension swaps out the built-in `edit` and `write` tools and swaps them back when a non-GPT model is selected.

| Case | Result |
|------|--------|
| OpenAI GPT provider active | replaces `write` and `edit` with `apply_patch` |
| Custom `openai-responses` GPT provider active | replaces `write` and `edit` with `apply_patch` |
| Non-GPT model active | restores the original `write` and `edit` toolset |
| Raw freeform patch input | accepted and applied |
| JSON `{ "input": "..." }` patch input | accepted and applied |
| Absolute or parent-escaping path | accepted and resolved by Node path semantics |

Activation rule (`isOpenAIGptModel`): model id starts with `gpt-` AND the provider is one of `openai`, `openai-codex`, `azure-openai-responses`, `github-copilot`, OR the model's API is `openai-responses` / `openai-codex-responses`.

## API adaptation vs upstream

Upstream targets pi's older `freeform: { type: "grammar", syntax: "lark", definition }` tool property. This repo's pi exposes grammar-constrained tools through `constrainedSampling`, so the tool registers:

```ts
constrainedSampling: {
  type: "grammar",
  variants: { openai_lark: APPLY_PATCH_LARK_GRAMMAR },
}
```

Providers with `compat.supportsOpenAIGrammarTools` receive an OpenAI custom grammar tool; other Responses-compatible models fall back to a function tool with a single `input` string parameter.

## Package layout

- `src/patch.ts` — pure patch parsing (`parsePatch`, `extractPatchedPaths`, heredoc stripping, fuzzy `replaceChunks`, change counting). Exported as `@htwang-contrib/apply-patch/patch` for the tool-display adapter.
- `src/apply.ts` — file application: atomic writes, per-file mutation queues (shared with pi's own file tools via `withFileMutationQueue`), `applyPatch` (fail-fast) and `applyPatchDetailed` (accumulates failures + recovery instructions).
- `src/preview.ts` — per-file previews with unified diffs, computed before application; `ApplyPatchToolDetails` is the display contract consumed by tool-display.
- `src/tool.ts` — the `ToolDefinition` (grammar, prompt snippet/guidelines, progress updates via `onUpdate`).
- `src/index.ts` — extension entry; toolset reconciliation on `session_start` / `model_select` / `before_agent_start`.

## Display

Rendering lives in `packages/tool-display/src/adapters/apply-patch.ts` (registered for tool name `apply_patch`) and follows this repo's Edit/Write style:

- Header: `ApplyPatch <path>` (bold title + accent path, `+N more` for multi-file patches, `...` while streaming).
- Collapsed: `└ patch [i/n] +N -M unified|side-by-side · F files [change bar]`, with `✗ N failed` when hunks failed. The header status icon turns red on failures.
- Expanded: per-file unified diffs rendered through the same `delta` pipeline as Edit (side-by-side on wide terminals), with `├`/`└` per-file headers for multi-file patches and a `✗` failure list.

The tool itself defines no `renderCall`/`renderResult`; without tool-display it falls back to pi's generic rendering.
