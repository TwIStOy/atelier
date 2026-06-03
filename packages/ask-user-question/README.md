# ask-user-question

Port of structured questionnaire tooling from [rpiv-ask-user-question](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question). Work is staged per [docs/ask-user-question/EXECUTION-STEPS.md](../../docs/ask-user-question/EXECUTION-STEPS.md).

## Phase 0 manual check

With this repo on your `pi.extensions` list, start interactive Pi and run:

`/auq-phase0`

The probe calls **`ctx.ui.custom(factory)`** with no options object, so the UI appears in the **prompt editor region** (same as [ghoseb/pi-askuserquestion](https://github.com/ghoseb/pi-askuserquestion)). Press Enter to call `done`; Pi restores the normal editor and shows an info notification with the JSON result.

### Phase 1 MVP UI demo

`/auq-phase1` opens the same **MVP questionnaire** used by `ask_user_question` (two sample questions from [`example-questionnaire.ts`](./example-questionnaire.ts)): **↑↓** move, **Enter** confirms each question, **Esc** cancels. After close, an info notification shows the **LLM-facing envelope** text from `buildQuestionnaireResponse`.

See [docs/ask-user-question/PHASE0.md](../../docs/ask-user-question/PHASE0.md) for locked dependency versions and porting notes.

## Tool layer (P1-1)

`packages/ask-user-question/tool/` — TypeBox **`QuestionParamsSchema`**, **`validateQuestionnaire`**, **`buildQuestionnaireResponse`** / **`buildAnswerSegment`**, **`formatAnswerScalar`**. `types.ts` inlines sentinel labels (aligned with rpiv `ROW_INTENT_META`) so this step does not depend on `state/row-intent.ts` yet.

Package root **`tool.ts`** (next to **`tool/`**) registers `ask_user_question` and holds prompt defaults; do not confuse with the `tool/` schema folder.

## Phase 1 — `ask_user_question` tool (MVP)

The extension registers **`ask_user_question`** in **`tool.ts`**. **`index.ts`** wires **`registerAskUserQuestionDemos`** from **`demo.ts`** (`/auq-phase0` editor-slot smoke test, `/auq-phase1` MVP questionnaire demo). When the port is finished, remove **`demo.ts`** and drop the `registerAskUserQuestionDemos` call from **`index.ts`** (and **`example-questionnaire.ts`** if nothing else imports it).

### Prompt snippet / guidelines (P1-2)

Edit **`tool.ts`** (`DEFAULT_PROMPT_SNIPPET`, `DEFAULT_PROMPT_GUIDELINES`) when you want to change what Pi injects into the system prompt for this tool.

### MVP behaviour vs rpiv (P1-4 / P1-5)

- **Editor slot only**: `execute` uses **`ctx.ui.custom(factory)`** with no overlay options (see [PHASE0.md](../../docs/ask-user-question/PHASE0.md)).
- **No `pi.events.emit`**: rpiv’s `ASK_USER_PROMPT_EVENT` is **not** emitted in Phase 1; Phase 2 will restore it if still desired.
- **Single-select only in UI**: if any question has **`multiSelect: true`**, the tool returns an error message and `cancelled: true` (MVP does not render checkboxes yet).
- **Interaction**: multi-question flows are supported sequentially (↑↓, Enter per question, Esc cancels entire run). There is **no** “Type something.” / “Chat about this” row yet; free-text and chat answers are Phase 2+.
- **Preview**: option `preview` is passed through to **`details` / envelope** when present; there is **no** Markdown preview pane in the MVP UI.

`content[0].text` and `details` for success / validation / `no_ui` follow the same **`buildToolResult` / `buildQuestionnaireResponse`** shapes as the rpiv tool layer.
