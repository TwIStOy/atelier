# Custom Provider — Mixed API per Model

A single custom provider can serve models that use **different streaming APIs**.
The `api` field is settable at two levels, and the model-level value wins over
the provider-level default. This lets one gateway expose, for example, an
OpenAI Responses model alongside an Anthropic Messages model without registering
two providers.

Verified against `pi-coding-agent` custom-provider docs (`docs/custom-provider.md`
in the pi install) — `ProviderModelConfig.api` and `ProviderModelConfig.baseUrl`
are both documented as per-model overrides.

## Resolution rule

```
model.api  ??  provider.api
model.baseUrl  ??  provider.baseUrl
```

- `provider.api` is the **fallback** for any model in the provider that does not
  set its own `api`.
- A model that sets `api` uses that API implementation regardless of the
  provider default. No second provider registration needed.
- `baseUrl` and `headers` behave the same way — per-model overrides take
  precedence, so models in one provider can even hit different endpoints.

## Example: one provider, two APIs

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerProvider("my-gateway", {
    name: "My Gateway",
    baseUrl: "https://gateway.example.com/v1",
    apiKey: "$MY_API_KEY",
    api: "openai-completions", // provider-level default for models without their own api
    models: [
      {
        id: "gpt-5-thinking",
        name: "GPT-5 (Responses)",
        api: "openai-responses", // this model uses the Responses API
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 16384,
      },
      {
        id: "claude-sonnet-4",
        name: "Claude Sonnet 4",
        api: "anthropic-messages", // this model uses the Anthropic Messages API
        baseUrl: "https://claude-gateway.example.com", // can even point elsewhere
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
        contextWindow: 200000,
        maxTokens: 16384,
      },
    ],
  });
}
```

## Available `api` types

Each value selects a bundled streaming implementation:

| API                        | Use for                                         |
| -------------------------- | ----------------------------------------------- |
| `anthropic-messages`       | Anthropic Claude API and compatibles            |
| `openai-completions`       | OpenAI Chat Completions API and compatibles     |
| `openai-responses`         | OpenAI Responses API                            |
| `azure-openai-responses`   | Azure OpenAI Responses API                      |
| `openai-codex-responses`   | OpenAI Codex Responses API                      |
| `mistral-conversations`    | Mistral SDK Conversations / Chat streaming      |
| `google-generative-ai`     | Google Generative AI API                        |
| `google-vertex`            | Google Vertex AI API                            |
| `bedrock-converse-stream`  | Amazon Bedrock Converse API                     |

For a model whose API is **not** in this list, the provider can register a
custom `streamSimple` implementation. Note: `streamSimple` is **provider-level
only** — it cannot be overridden per model. So for mixing non-standard APIs,
split them into separate providers; for mixing standard APIs, use the per-model
`api` override shown above.

## Per-model fields that can override the provider

| Field      | Provider-level | Model-level override | Notes                                            |
| ---------- | -------------- | -------------------- | ------------------------------------------------ |
| `api`      | yes (default)  | yes                  | Selects the streaming implementation.            |
| `baseUrl`  | yes            | yes                  | Different endpoint per model is supported.       |
| `headers`  | yes            | yes                  | Merge model headers on top of provider headers.  |
| `apiKey`   | yes            | no                   | Provider-level only.                             |
| `authHeader` | yes          | no                   | Provider-level only.                             |
| `oauth`    | yes            | no                   | Provider-level only.                             |
| `streamSimple` | yes        | no                   | Provider-level only; cannot override per model.  |

## When to split into multiple providers instead

- You need different **auth** (`apiKey`, `oauth`, `authHeader`) — auth is
  provider-level, so models with different credentials must be separate
  providers.
- You need a **custom `streamSimple`** for one model but standard APIs for
  others — `streamSimple` cannot be set per model.
- You want the models to appear under different display groups in `/login` or
  the model picker.

## Reference

- pi custom-provider docs: `docs/custom-provider.md` under the
  `@earendil-works/pi-coding-agent` install.
- Example provider extensions:
  `examples/extensions/custom-provider-anthropic/` and
  `examples/extensions/custom-provider-gitlab-duo/` in the pi install.
