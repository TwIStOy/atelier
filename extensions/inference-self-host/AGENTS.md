# Inference Self-Host Extension

Self-hosted proxy provider aggregating models from multiple upstreams. Reads `INFERENCE_TWISTOY_API_KEY` env var.

## Compat Overrides (Critical)

The proxy URL (`inference.twistoy.cn`) doesn't match any pi-ai auto-detection pattern, so **all models get generic OpenAI compat defaults which are wrong** for most upstream families. Always set `compat` explicitly per model:

- **ZAI/GLM**: `thinkingFormat: "zai"`, `zaiToolStream: true`, `supportsDeveloperRole: false`
- **DeepSeek**: `thinkingFormat: "deepseek"`, `requiresReasoningContentOnAssistantMessages: true`, `supportsDeveloperRole: false`
- **Moonshot/Kimi**: `supportsReasoningEffort: false`, `maxTokensField: "max_tokens"`, `supportsDeveloperRole: false`
- **Qwen**: `thinkingFormat: "qwen"`, `supportsDeveloperRole: false`

See `.agents/skills/pi-self-extension/SKILL.md` for full compat field reference.

## Sync Tooling

- `sync.ts` -- fetches model specs from `https://models.dev/api.json` with a fallback chain per model.
- `sync-cli.ts` -- CLI runner: `npx tsx extensions/inference-self-host/sync-cli.ts`
- Model specs (costs, context windows) should be sourced from `models.dev`, not hardcoded.
