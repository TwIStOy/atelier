# Inference (Self Host) Extension

A pi extension that registers the "Inference(Self Host)" provider with models from various providers.

## Configuration

Set these environment variables:

- `INFERENCE_TWISTOY_API_KEY` — your API key

The base URL is `https://inference.twistoy.cn`.

## Syncing Model Parameters from models.dev

Model specs (context window, max output, cost, reasoning support) are sourced from [models.dev](https://models.dev). The `sync.ts` module automates fetching and converting this data.

### Provider mapping

Each model is mapped to a specific provider in models.dev. The mapping is defined in `sync.ts` → `MODEL_SOURCES`:

| Local ID | Provider | models.dev Model ID | Notes |
|---|---|---|---|
| `mimo-v2-pro` | `xiaomi` | `mimo-v2-pro` | |
| `glm-5` | `zai-coding-plan` | `glm-5` | Fallback: `zhipuai` → `glm-5` |
| `glm-4.5-air` | `zai-coding-plan` | `glm-4.5-air` | |
| `glm-4.5` | `zhipuai` | `glm-4.5` | |
| `qwen3.5-plus` | `alibaba` | `qwen3.5-plus` | |
| `glm-5.1` | `zai-coding-plan` | `glm-5.1` | |
| `qwen3.7-max` | `alibaba` | `qwen3.7-max` | |
| `glm-5-turbo` | `zai-coding-plan` | `glm-5-turbo` | |
| `mimo-v2-omni` | `xiaomi` | `mimo-v2-omni` | |
| `kimi-k2.6` | `moonshotai` | `kimi-k2.6` | |
| `deepseek-v4-pro` | `deepseek` | `deepseek-v4-pro` | |
| `minimax-m2.5` | `minimax` | `MiniMax-M2.5` | |
| `minimax-m2.7` | `minimax` | `MiniMax-M2.7` | |
| `hy3-preview` | `tencent-tokenhub` | `hy3-preview` | |
| `kimi-k2.5` | `moonshotai` | `kimi-k2.5` | |
| `mimo-v2.5` | `xiaomi` | `mimo-v2.5` | |
| `qwen3.6-plus` | `alibaba` | `qwen3.6-plus` | |
| `mimo-v2.5-pro` | `xiaomi` | `mimo-v2.5-pro` | |
| `deepseek-v4-flash` | `deepseek` | `deepseek-v4-flash` | |
| `glm-4.7` | `zai-coding-plan` | `glm-4.7` | |
| `glm-4.6` | `zhipuai` | `glm-4.6` | |

### Field mapping

| models.dev API Field | Extension Config Field |
|---|---|
| `reasoning` | `reasoning` |
| `modalities.input` | `input` |
| `cost.input` | `cost.input` |
| `cost.output` | `cost.output` |
| `cost.cache_read` | `cost.cacheRead` |
| `cost.cache_write` | `cost.cacheWrite` |
| `limit.context` | `contextWindow` |
| `limit.output` | `maxTokens` |

### Running the sync

```bash
npx tsx extensions/inference-self-host/sync-cli.ts
```

This fetches from `https://models.dev/api.json`, resolves each model through its provider mapping (with fallback support), and outputs the full `ProviderModelConfig[]` JSON. Use this output to update the `models` array in `index.ts`.

### Notes

- The `zai-coding-plan` provider has `cost: 0` for all models since it's a subscription plan.
- Some providers use tiered pricing (e.g., `context_over_200k`). The sync only stores the base tier cost.
- Models not found in the primary provider fall back to the `fallbacks` chain before emitting a warning.
