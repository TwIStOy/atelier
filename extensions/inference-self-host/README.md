# Inference (Self Host) Extension

A pi extension that registers the "Inference(Self Host)" provider, proxying to various upstream LLM providers through `https://inference.twistoy.cn`.

## Configuration

Set these environment variables:

- `INFERENCE_TWISTOY_API_KEY` — your API key

The base URL is `https://inference.twistoy.cn/v1`.

## Models

21 models from 7 upstream provider families:

| Local ID | Upstream Family | Reasoning |
|---|---|---|
| `glm-5.1` | ZAI (GLM) | yes |
| `glm-5` | ZAI (GLM) | yes |
| `glm-5-turbo` | ZAI (GLM) | yes |
| `glm-4.6` | ZAI (GLM) | yes |
| `glm-4.7` | ZAI (GLM) | no |
| `glm-4.5` | ZAI (GLM) | no |
| `glm-4.5-air` | ZAI (GLM) | no |
| `deepseek-v4-pro` | DeepSeek | yes |
| `deepseek-v4-flash` | DeepSeek | yes |
| `kimi-k2.6` | Moonshot | yes |
| `kimi-k2.5` | Moonshot | yes |
| `qwen3.7-max` | Qwen (Alibaba) | yes |
| `qwen3.6-plus` | Qwen (Alibaba) | yes |
| `qwen3.5-plus` | Qwen (Alibaba) | yes |
| `mimo-v2.5-pro` | Xiaomi | yes |
| `mimo-v2.5` | Xiaomi | yes |
| `mimo-v2-pro` | Xiaomi | yes |
| `mimo-v2-omni` | Xiaomi | yes |
| `minimax-m2.7` | MiniMax | yes |
| `minimax-m2.5` | MiniMax | yes |
| `hy3-preview` | Tencent | yes |

## API Compatibility

Since `inference.twistoy.cn` doesn't match any auto-detection pattern in pi-ai, all models that need non-standard compat have explicit overrides:

| Family | Compat Overrides |
|---|---|
| **ZAI (GLM)** | `supportsDeveloperRole: false`, `thinkingFormat: "zai"`, `zaiToolStream: true` |
| **DeepSeek** | `supportsDeveloperRole: false`, `thinkingFormat: "deepseek"`, `requiresReasoningContentOnAssistantMessages: true` |
| **Moonshot (Kimi)** | `supportsDeveloperRole: false`, `supportsReasoningEffort: false`, `maxTokensField: "max_tokens"` |
| **Qwen** | `supportsDeveloperRole: false`, `thinkingFormat: "qwen"` |
| Xiaomi, MiniMax, Tencent | Standard OpenAI compat, no overrides needed |

## Syncing Model Parameters from models.dev

Model specs (context window, max output, cost, reasoning support) are sourced from [models.dev](https://models.dev). The `sync.ts` module automates fetching and converting this data.

### Provider mapping

Most models use `opencode-go` as the primary provider. GLM models not available in `opencode-go` fall back to `zai-coding-plan` or `zhipuai`.

| Local ID | Primary Provider | Fallbacks | Compat Family |
|---|---|---|---|
| `mimo-v2-pro` | `opencode-go` | — | — |
| `glm-5` | `opencode-go` | `zai-coding-plan`, `zhipuai` | `zai` |
| `glm-4.5-air` | `zai-coding-plan` | `zhipuai` | `zai` |
| `glm-4.5` | `zhipuai` | — | `zai` |
| `qwen3.5-plus` | `opencode-go` | — | `qwen` |
| `glm-5.1` | `opencode-go` | `zai-coding-plan` | `zai` |
| `qwen3.7-max` | `opencode-go` | — | `qwen` |
| `glm-5-turbo` | `zai-coding-plan` | — | `zai` |
| `mimo-v2-omni` | `opencode-go` | — | — |
| `kimi-k2.6` | `opencode-go` | — | `moonshot` |
| `deepseek-v4-pro` | `opencode-go` | — | `deepseek` |
| `minimax-m2.5` | `opencode-go` | — | — |
| `minimax-m2.7` | `opencode-go` | — | — |
| `hy3-preview` | `tencent-tokenhub` | — | — |
| `kimi-k2.5` | `opencode-go` | — | `moonshot` |
| `mimo-v2.5` | `opencode-go` | — | — |
| `qwen3.6-plus` | `opencode-go` | — | `qwen` |
| `mimo-v2.5-pro` | `opencode-go` | — | — |
| `deepseek-v4-flash` | `opencode-go` | — | `deepseek` |
| `glm-4.7` | `zai-coding-plan` | `zhipuai` | `zai` |
| `glm-4.6` | `zhipuai` | — | `zai` |

### Running the sync

```bash
npx tsx extensions/inference-self-host/sync-cli.ts
```

This fetches from `https://models.dev/api.json`, resolves each model through its provider mapping (with fallback support), and outputs the full `ProviderModelConfig[]` JSON. Use this output to update the `models` array in `index.ts`.
