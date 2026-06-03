# ask-user-question

Port of structured questionnaire tooling from [rpiv-ask-user-question](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question). Work is staged per [docs/ask-user-question/EXECUTION-STEPS.md](../../docs/ask-user-question/EXECUTION-STEPS.md).

## Phase 0 manual check

With this repo on your `pi.extensions` list, start interactive Pi and run:

`/auq-phase0`

The probe calls **`ctx.ui.custom(factory)`** with no options object, so the UI appears in the **prompt editor region** (same as [ghoseb/pi-askuserquestion](https://github.com/ghoseb/pi-askuserquestion)). Press Enter to call `done`; Pi restores the normal editor and shows an info notification with the JSON result.

### Phase 1 UI demo

`/auq-phase1` uses the same questionnaire component as the tool (two sample questions from [`example-questionnaire.ts`](./example-questionnaire.ts)): **↑↓** move, **Enter** confirms each question, **Esc** cancels. After close, an info notification shows the **LLM-facing envelope** text from `buildQuestionnaireResponse`.

### Phase 2 hand-test demo

`/auq-phase2` runs [`example-phase2-questionnaire.ts`](./example-phase2-questionnaire.ts): first question is **multi-select** (**Space** toggles, **Enter** on **Submit** confirms); second is single-select with a **Chat about this** row (**Enter** on that row ends with a `chat` answer). The demo calls **`emitAskUserPrompt`** before opening the UI so you can subscribe to **`ask_user_question:prompt`** (same event as the real tool after validation). Use this to verify keyboard flow and envelope text in the editor slot.

See [docs/ask-user-question/PHASE0.md](../../docs/ask-user-question/PHASE0.md) for locked dependency versions and porting notes.

## Tool layer (P1-1)

`packages/ask-user-question/tool/` — TypeBox **`QuestionParamsSchema`**, **`validateQuestionnaire`**, **`buildQuestionnaireResponse`** / **`buildAnswerSegment`**, **`formatAnswerScalar`**. `types.ts` inlines sentinel labels (aligned with rpiv `ROW_INTENT_META`) so this step does not depend on `state/row-intent.ts` yet.

Package root **`tool.ts`** (next to **`tool/`**) registers `ask_user_question` and holds prompt defaults; do not confuse with the `tool/` schema folder.

## Phase 1 — `ask_user_question` tool (MVP)

The extension registers **`ask_user_question`** in **`tool.ts`**. **`index.ts`** wires **`registerAskUserQuestionDemos`** from **`demo.ts`** (`/auq-phase0`, `/auq-phase1`, `/auq-phase2`). When the port is finished, remove **`demo.ts`** and drop the `registerAskUserQuestionDemos` call from **`index.ts`** (and demo-only example modules if nothing else imports them).

### Prompt snippet / guidelines (P1-2)

Edit **`tool.ts`** (`DEFAULT_PROMPT_SNIPPET`, `DEFAULT_PROMPT_GUIDELINES`) when you want to change what Pi injects into the system prompt for this tool.

### Current UI vs rpiv (Phase 2 增量中)

- **Editor slot only**: `execute` uses **`ctx.ui.custom(factory)`** with no overlay options (see [PHASE0.md](../../docs/ask-user-question/PHASE0.md)).
- **`pi.events.emit`**: after successful validation, **`emitAskUserPrompt`** emits **`ask_user_question:prompt`** with per-question **`header` / `question` / `multiSelect` / `hasPreview`** only (no preview body). See [`events.ts`](./events.ts).
- **Multi-select**: supported in **[`questionnaire-ui.ts`](./questionnaire-ui.ts)**; **`multiSelect` + non-empty `preview` on any option** is rejected at validation (`multi_select_preview`).
- **Single-select**: **Chat about this** row is shown; **“Type something.”** custom row is not implemented yet (full parity is later Phase 2).
- **Preview**: for single-select questions that have any option `preview`, the UI shows a **plain-text stub** (first lines only); **not** the rpiv Markdown `PreviewPane` / `getMarkdownTheme` pipeline yet. Selected option `preview` is still passed through to **`details` / envelope** when the user confirms an option.

`content[0].text` and `details` for success / validation / `no_ui` follow the same **`buildToolResult` / `buildQuestionnaireResponse`** shapes as the rpiv tool layer.
