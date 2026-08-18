# inject-prompt-by-model

Injects extra system-prompt text based on the currently active model.

On `session_start` / `model_select` the extension builds a target string
`<provider>/<modelId>` from `ctx.model` (e.g. `zai/glm-4.7`) and tests it
against a hardcoded, ordered rule list under `src/rules/`. **All** rules
whose regex matches are cached for the session, joined with a blank line, in
the exact registration order of `MODEL_PROMPT_RULES` — the order is fixed so
the injected prefix stays byte-stable across turns (prompt-cache friendly).
Matched rules are applied through the shared system-prompt contribution
registry (`priority` 300, `mode: "replace"`). A rule may `prompt` (append) and/or
`replaceFirstLine` (swap the first line of the current prompt). No rule
matches → the callback returns null and the system prompt is left untouched.

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

Rules are evaluated in array order. Append `prompt`s join in that order;
if several rules set `replaceFirstLine`, the last match wins. The extension
can be disabled entirely via `isExtensionDisabled("inject-prompt-by-model")`.
