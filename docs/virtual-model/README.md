# Virtual Model

Requires Pi 0.99.1 or newer. The extension registers `virtual/auto` as a selectable
model. It routes requests to three physical chat models in ascending capability:
`flash`, `middle`, and `flagship`.

## Setup

1. Configure the physical providers and their credentials in Pi.
2. Open `/config` → **Virtual Model** and select **Flash Model**, **Middle Model**,
   **Flagship Model**, and **Judge Model**.
3. Select **Auto (Flash / Middle / Flagship)** from `/model`, or start Pi with
   `--model virtual/auto`.

All settings live in the shared `extensions.json` store. Model references are
exact `provider/model` identifiers; model IDs may themselves contain slashes.
There are no hardcoded physical tier models. Configure all three before selecting
the virtual model. Settings are read for every routed request.

```json
{
  "virtual-model": {
    "flashModel": "your-provider/your-fast-model",
    "middleModel": "your-provider/your-middle-model",
    "flagshipModel": "your-provider/your-strongest-model",
    "judgeModel": "typesafe/jev-latest",
    "judgeTimeoutMs": 30000
  }
}
```

## Judge models

**Judge Model** lists both physical chat models and classifier models from Pi's
registry. Classifiers are marked `(classifier)`. The default is
`typesafe/jev-latest`. To use an ordinary LLM, select its `provider/model` instead;
no separate protocol setting is needed.

Toori catalog entries that advertise `typesafe-systemone` appear as classifiers
too. After `/refresh-toori`, select `toori/<jev-model-id>` to use the gateway's
existing endpoint and credentials.

The judge uses Pi's provider authentication, endpoint overrides, and request
transport. For TypeSafe, configure its provider credentials in Pi, for example
through `TYPESAFE_API_KEY`. A gateway or other classifier provider can be added
through Pi's model configuration. The shared **System One** extension settings
used for transcript annotations do not configure this native Pi classifier.

Classifier models receive one structured choice question. Chat models receive the
same rubric and must return exactly `flash`, `middle`, or `flagship`. The judge
sees the current request's entire conversation, system messages, tool definitions,
and tool results. Images are represented by MIME/type markers; image bytes are not
sent to the text judge. Judgments are advisory estimates of required capability;
the model assignments determine what each tier can do.

The timeout bounds the entire judgment. Cancellation, invalid output, missing
models, missing credentials, and judge failures stop the request with an error.
They do not fabricate a decision or lower the stored tier. Judge calls use no
provider retries. Judge usage is not included in the main assistant usage totals.

## Routing and persistence

The extension judges each new user request and each continuation after tool
results, so newly discovered difficulty can raise the tier during a task. The
next tier is the maximum of the decision and the highest tier already reached
in the session. At `flagship`, further judge calls are skipped.

Automatic retries after a physical model failure keep the current tier.
If routing failed during judgment, its retry must obtain a valid judgment first.
Direct requests, including compaction
and extension side-calls through `virtual/auto`, also use that tier without
invoking the judge. Before the first routed request, that floor is `flash`.
The selected Pi thinking level is forwarded to the physical model; Pi clamps it
to the levels that model supports. Tier and thinking level are independent.

The floor is recorded in custom session entries and recovered from all session
entries, including abandoned branches. Resume, `/reload`, compaction, switching
away and back, and `/tree` navigation therefore cannot lower it. A new session
starts at `flash`. A fork inherits the tier entries in its copied history, then
maintains its own floor. There is no downgrade/reset command within a session.
Changing the physical model assigned to a tier changes that tier's target without
changing its rank; keep assignments in increasing capability order.

Pi keeps `virtual/auto` selected while assistant messages record the physical
model that answered. A persisted promotion remains in force if the physical
request subsequently fails.

## Current model and context window

The statusline's editor border shows the active route, for example
`Auto · middle → toori/your-model`. `/context` shows the physical model and its
effective thinking level in the detailed usage view. Message complexity
percentages are independent annotations, not the tier actually selected.

Before the first route, Auto advertises the configured Flash model's context and
output limits. After a conversation route selects a model, those limits and the
statusline update immediately, before the response arrives. Resumed sessions use
their saved tier and its configured model. Configuration changes are synchronized
on model selection and before the next agent run. Unconfigured models leave usage
unknown until configuration is valid.

The window is the current target's limit, not the minimum across all three tiers.
A stronger tier can have a smaller window. Pi checks the physical target before
dispatch and compacts when auto-compaction is enabled. The custom auto-compact
extension, statusline, and `/context` share the effective target window; they
retain Pi's token estimate and recompute percentages against that window.
Unknown usage after compaction remains unknown.

Pi's native context-usage API still uses the last successful physical response's
window, which may lag a newly chosen route. The shared effective-window helpers
correct this for the extension surfaces above. Direct requests such as compaction
summaries do not overwrite the displayed conversation route.

The extension is included in the root bundle. It can also be loaded directly with
`pi -e ./packages/virtual-model/src/index.ts`. The standard extension disable flag
uses the ID `virtual-model`.
