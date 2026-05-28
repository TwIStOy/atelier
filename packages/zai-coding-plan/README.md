# Z.AI Coding Plan Provider

Registers the [Z.AI GLM Coding Plan](https://docs.z.ai/devpack/overview) as a provider in pi coding agent.

## Setup

Set the `ZAI_API_KEY` environment variable with your Z.AI API key (create one at [z.ai/manage-apikey/apikey-list](https://z.ai/manage-apikey/apikey-list)).

## Supported Models

| Model         | Context | Max Output | Reasoning | Notes                  |
| ------------- | ------- | ---------- | --------- | ---------------------- |
| `glm-5.1`     | 200K    | 128K       | yes       | Flagship, all plans    |
| `glm-5`       | 200K    | 128K       | yes       | Pro/Max plans only     |
| `glm-5-turbo` | 200K    | 16K        | yes       | All plans              |
| `glm-4.7`     | 128K    | 16K        | no        | All plans              |
| `glm-4.5-air` | 128K    | 16K        | no        | Lightweight, all plans |

## API Endpoint

- **OpenAI-compatible**: `https://api.z.ai/api/coding/paas/v4`
- **Anthropic-compatible**: `https://api.z.ai/api/anthropic`

This extension uses the OpenAI Chat Completions endpoint.

## Quota & Usage

Two ways to check your Coding Plan quota:

### Tool (LLL-callable)

The `zai_quota` tool is registered for the LLM to call. Ask the agent "check my Z.AI quota" and it will invoke the tool automatically.

### Command

```
/zai-quota
```

Queries three Z.AI monitoring endpoints in parallel:

| Endpoint    | URL                                              | Info                                            |
| ----------- | ------------------------------------------------ | ----------------------------------------------- |
| Quota Limit | `https://api.z.ai/api/monitor/usage/quota/limit` | 5h/weekly quota percentages, reset times        |
| Model Usage | `https://api.z.ai/api/monitor/usage/model-usage` | Token count, model call count (24h window)      |
| Tool Usage  | `https://api.z.ai/api/monitor/usage/tool-usage`  | Web search, web read, ZRead counts (24h window) |

Auth uses the same `ZAI_API_KEY` env var, passed as the `Authorization` header (no Bearer prefix).

Reference implementation: [guyinwonder168/opencode-glm-quota](https://github.com/guyinwonder168/opencode-glm-quota)

## Keeping Models Up to Date

Check these sources when updating the model list:

1. **Official supported models list**: [docs.z.ai/devpack/overview](https://docs.z.ai/devpack/overview) — the "Supported Models" section lists all Coding Plan models.
2. **Tool integration config example**: [docs.z.ai/devpack/tool/others](https://docs.z.ai/devpack/tool/others) — shows the exact model IDs to enter (e.g. `GLM-5.1`, `GLM-5`, `GLM-5-Turbo`, `GLM-4.7`, `GLM-4.5-air`).
3. **Pricing page**: [docs.z.ai/guides/overview/pricing](https://docs.z.ai/guides/overview/pricing) — per-token costs for cost tracking.
4. **Individual model pages**: `https://docs.z.ai/guides/llm/<model-slug>` (e.g. `glm-5.1`, `glm-5`) — context window, max output, and capabilities.

Third-party references (may lag behind official docs):

- [Mastra Z.AI Coding Plan](https://mastra.ai/models/providers/zai-coding-plan)
- [VoltAgent Z.AI Coding Plan](https://voltagent.dev/models-docs/providers/zai-coding-plan/)
