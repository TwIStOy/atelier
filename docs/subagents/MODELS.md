# Subagent model tiers

Configure `cheap`, `middle`, and `flagship` once, then assign a tier to each persona. Changing a tier's model updates every persona using that tier on its next run. Single calls, parallel batches, background calls, and workflow agents share the same resolution.

Open `/config` → **Subagents** to choose each tier's model from the currently available `provider/model-id` list and assign each discovered persona's tier. Type directly in a model list to fuzzy-filter it: abbreviations such as `dsv4f` match `deepseek-v4.1-flash`, and space-separated terms such as `flash toori` match both the model and provider. Select **Current session** for a tier or persona to inherit the parent session's model. `/subagents-agents` shows the effective model after resolving configuration and persona defaults.

Settings are stored in `~/.config/pi/extensions.json`, or `$XDG_CONFIG_HOME/pi/extensions.json` when set:

```json
{
  "subagents": {
    "modelTiers": {
      "cheap": "provider/small-model",
      "middle": "provider/medium-model",
      "flagship": "provider/large-model"
    },
    "agentModels": {
      "explore": "cheap",
      "scout": "middle",
      "plan": "flagship",
      "general-purpose": ""
    }
  }
}
```

Replace the example model patterns with models available in your Pi registry. Exact `provider/model-id` values avoid ambiguous matches; existing model name patterns also work. All three tiers are empty by default, so an unconfigured tier inherits the current session model.

The shipped persona defaults are:

| Persona | Model selection |
| --- | --- |
| `explore` | `cheap` |
| `scout` | `middle` |
| `plan` | `flagship` |
| `general-purpose` | Current session |

`agentModels` overrides the persona's Markdown `model` field. Its values may be a tier, a concrete model pattern, or `""` to explicitly use the current session. Remove an entry to restore that persona's Markdown/default-settings behavior. Custom personas can reference tiers with `model: cheap`, `model: middle`, or `model: flagship` in frontmatter, and appear in `/config` after `/reload`.

Model selection uses this precedence:

1. Per-task `model` in a batch.
2. The call's `model` (or batch default).
3. `subagents.agentModels[agentId]` in extension config.
4. Persona Markdown `model`.
5. `defaults_by_agent_type[agentId].model` in the existing subagent `settings.json`.
6. The current parent session model.

After selecting a value, `cheap`, `middle`, and `flagship` resolve through `modelTiers`. An empty selection or unset tier uses the parent model. A concrete pattern that does not match an available model retains the existing parent-model fallback. Tier values are concrete patterns, not references to other tiers. Use a provider-qualified id such as `provider/cheap` to select a model literally named `cheap`.

Examples:

```json
{ "agent_type": "explore", "task": "Find the API routes" }
```

Uses the configured selection for `explore` (shipped default: `cheap`).

```json
{ "agent_type": "explore", "model": "flagship", "task": "Trace this complex lookup" }
```

Overrides the persona selection for this call.

```json
{ "agent_type": "explore", "model": "", "task": "Find the API routes" }
```

Uses the current session model even when the persona has a configured tier. A plain `subagent` call without `agent_type` or `model` continues to use `general-purpose`, which has no shipped model override.

These settings select the model only. The existing `thinking`, tool isolation, and turn-limit settings retain their own precedence.
