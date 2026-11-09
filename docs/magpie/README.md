# Magpie

The extension has two roles: a Pi provider backed by a Magpie gateway, and a
System One classifier whose decision models are registered as native Pi
classifier models.

## Configuration

`/config` → **Magpie**, persisted under `magpie` in `extensions.json`:

| Setting | Environment override | Default | Meaning |
| --- | --- | --- | --- |
| Gateway URL | `MAGPIE_BASE_URL` | `http://100.65.0.3:3425` | Gateway root, without `/v1` |
| API Key | `MAGPIE_API_KEY` | the gateway key shipped with the extension | Literal key or `$VAR` / `{env:VAR}` reference |
| Classifier Models | — | `group/classifier` | Decision model ids to register, comma or space separated |
| Classifier Timeout (ms) | — | `10000` | Timeout per attempt, including body delivery |
| Classifier Max Retries | — | `2` | Retries after the initial attempt; `0` disables them |
| Image Timeout (ms) | — | `300000` | Timeout for `generate_image` calls, matching magpie's image timeout |

```json
{
  "magpie": {
    "url": "http://100.65.0.3:3425",
    "apiKey": "$MAGPIE_KEY",
    "classifierModels": "group/classifier"
  }
}
```

The provider uses `<url>/v1` and the catalog comes from `GET /v1/models`.
`MAGPIE_BASE_URL` overrides the stored URL; an explicit environment reference in
`apiKey` takes precedence over `MAGPIE_API_KEY`, and an unset or blank reference
is an error rather than a fallback. Reads happen per request; provider
connection values are re-read at `session_start`.

## Image generation

The extension registers a `generate_image` tool that draws through the Magpie
gateway's image models. With `reference_images` it edits or combines; without
them it generates from the prompt.

- **Endpoint**: `POST <url>/v1/images/generations`, or `/v1/images/edits` when
  `reference_images` names local files (sent as data URLs). The request always
  asks for base64 image data (`response_format`); a URL-only answer is
  downloaded as a fallback.
- **Parameters**: `prompt` (required), `size` (`WIDTHxHEIGHT` or a ratio like
  `16:9`), `n` (1-4), `reference_images` (up to 5 file paths), `quality`
  (`low`/`medium`/`high`/`xhigh`/`max`/`auto`), `background`
  (`transparent`/`opaque`/`auto`), and `model` (a magpie image model id or
  `group/<id>`; omitted, magpie uses the model picked in its Settings →
  Images → Image generation).
- **Result**: each image is saved to the working directory as
  `<slug>-<timestamp>[-N].<ext>` and returned as an image content block. The
  tool renders its own row (`renderShell: "self"`) in tool-display's visual
  language (bold verb header with the quoted prompt, muted one-line summary
  collapsed, `saved <path>` lines expanded), and pi appends the images inline
  right below it (kitty/sixel; a text indicator otherwise) while multimodal
  models see what they drew. `details` carries the model, saved paths, and the
  revised prompt. Defining its own renderers also makes tool-display defer to
  the stock renderer (`usesStockRenderer`), which is what keeps the inline
  images when tool-display is loaded.
- **Timeout**: **Image Timeout (ms)** (default 300000, magpie's own default).
  Slow image models need a larger value on both sides.
- **Key**: the same gateway key as the provider; magpie answers remote calls
  without one with 401, which the tool surfaces as a `/config` hint.

The tool shape follows Codex's `image_gen.imagegen` (prompt, transparency via
  `background`, reference images, quality) and magpie's own `generate_image`
  MCP tool, minus what has no magpie equivalent (GIF frames, conversation
  image inclusion).

## Classifier models

Magpie serves `POST /v1/systemone` itself and asks its decision models there,
but its `/v1/models` list does not include them, so the **Classifier Models**
setting names them explicitly. Every listed id is registered as a Pi classifier
model:

- id `group/classifier` (magpie's decision group), model reference
  `magpie/group/classifier`, api `typesafe-system-one`, `baseUrl` `<url>/v1`
  (Pi appends `/systemone`), context window 32768.
- Plain decision model ids (`jev-latest`), other decision groups, and
  provider-qualified names (`typesafe/jev-latest`) work the same way; a
  conversation model is refused with 404 and a group of conversation models
  with 400.

Classifier models do not appear in `/model`; Pi reaches them through
`ctx.modelRegistry.classify()`, the `codemode` tool, and virtual-model routing.
Transcript annotations pick one through their own configuration (below). The
transport is `@htwang-contrib/magpie/classifier` (`magpieSystemOneClassifier`):
it maps public `bool` questions to wire-level `noul`, parses choice/score
answers and token usage into Pi's `ClassifierResult` shape, and applies the
timeout and retry settings above. Extensions cannot import Pi's built-in
`typesafe-system-one` transport (Pi's module aliasing hides its subpath), which
is why the transport lives here.

Requests authenticate with the provider's gateway key through Pi's
request-time auth, so `/login` credentials and the magpie key stay separate.

## Transcript annotations

Both consumers are display-only: they never select a model and never gate a
command. Each picks its classifier model from every registered one (magpie,
TypeSafe, Cloudflare, llama.cpp decision models, …) and calls
`ctx.modelRegistry.classify`:

- **User Message → Classifier Model** and **Complexity Assessment**: one choice
  question labels the least expensive suitable tier as `flash`, `middle`, or
  `flagship`; all three probabilities appear in a muted row below the message.
  The classifier sees the current system prompt and the complete conversation.
- **Tool Display → Classifier Model** and **Bash Assessments**: two bool
  questions estimate `destructive` and `exfiltration` probabilities, shown
  after the Bash output count.

Both default to `magpie/group/classifier`; a missing model (provider not loaded, id
renamed) silently disables the annotation. Requests run in the background, start
only for new TUI messages and tool calls, and are cancelled with the turn or
session. Failures are logged and leave the transcript unchanged.

## Notes

- The decision model's context window applies: 31k input tokens succeeded and
  37k was refused with `400 max_tokens_exceeded` on Jev. The user-message
  consumer sends the whole conversation, so a long session loses that row.
- `state` must be a JSON object; `null` is refused upstream with `422`.
- Direct `https://api.typesafe.ai` is region-blocked from some networks
  (`HTTP 451`); the annotations intentionally do not fall back to it.

## Sources

- [Magpie reference](https://github.com/yetone/magpie/blob/main/docs/reference.md)
- [Pi: use classifier models](https://github.com/earendil-works/pi/blob/main/docs/models.md)
