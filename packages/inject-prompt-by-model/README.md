# inject-prompt-by-model

Injects extra system-prompt text based on the currently active model.

On every `before_agent_start`, the extension builds a target string
`<provider>/<modelId>` from `ctx.model` (e.g. `zai/glm-4.7`) and tests it
against a hardcoded, ordered rule list in `src/rules.ts`. The **first** rule
whose regex matches wins; its `prompt` is appended to the system prompt for
that turn. No rule matches → the system prompt is left untouched.

## Adding a rule

Edit `MODEL_PROMPT_RULES` in `src/rules.ts`:

```ts
export const MODEL_PROMPT_RULES: ModelPromptRule[] = [
  {
    name: "glm",
    pattern: /^zai\/glm-/,
    prompt: "Extra instructions for GLM models...",
  },
];
```

Rules are evaluated in array order, so put specific patterns before broad
ones. The extension can be disabled entirely via the standard
`isExtensionDisabled("inject-prompt-by-model")` kill switch.
