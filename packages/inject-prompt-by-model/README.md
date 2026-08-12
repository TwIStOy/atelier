# inject-prompt-by-model

Injects extra system-prompt text based on the currently active model.

On every `before_agent_start`, the extension builds a target string
`<provider>/<modelId>` from `ctx.model` (e.g. `zai/glm-4.7`) and tests it
against a hardcoded, ordered rule list under `src/rules/`. **All** rules
whose regex matches are appended to the system prompt for that turn, joined
with a blank line, in the exact registration order of `MODEL_PROMPT_RULES` —
the order is fixed so the injected prefix stays byte-stable across turns
(prompt-cache friendly). No rule matches → the system prompt is left untouched.

## Adding a rule

Create one file per rule in `src/rules/`, then register it in
`src/rules/index.ts`:

```ts
// src/rules/glm.ts
import type { ModelPromptRule } from "./index.ts";

export const glmRule: ModelPromptRule = {
  name: "glm",
  pattern: /^zai\/glm-/,
  prompt: "Extra instructions for GLM models...",
};
```

```ts
// src/rules/index.ts
import { glmRule } from "./glm.ts";

export const MODEL_PROMPT_RULES: ModelPromptRule[] = [glmRule];
```

Rules are evaluated in array order and every match is injected in that same
fixed order, so register rules in the exact sequence you want them appended. The extension can be disabled entirely via the standard
`isExtensionDisabled("inject-prompt-by-model")` kill switch.
