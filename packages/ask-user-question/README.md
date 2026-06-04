# ask-user-question

Port of structured questionnaire tooling from [rpiv-ask-user-question](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question) (MIT). Work is staged per [docs/ask-user-question/EXECUTION-STEPS.md](../../docs/ask-user-question/EXECUTION-STEPS.md).

## Layout

| Path                 | Role                                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`tool/`**          | TypeBox schema, **`validateQuestionnaire`**, response envelope, **`formatAnswerScalar`**. **`types.ts`** pulls **`SENTINEL_LABELS`** from **`state/row-intent.ts`** (single source with **`ROW_INTENT_META`**). |
| **`state/`**         | **`QuestionnaireSession`**, **`reduce`**, **`key-router`**, **`selectors/`**, **`build-questionnaire.ts`**.                                                                                                     |
| **`view/`**          | **`DialogView`**, tab strategies, **`PreviewPane`**, **`MultiSelectView`**, **`QuestionnairePropsAdapter`**.                                                                                                    |
| **`tool.ts`**        | Registers **`ask_user_question`**, prompt defaults, **`execute`** → **`emitAskUserPrompt`** → **`ctx.ui.custom`** (editor slot **only** — no overlay object).                                                   |
| **`build-items.ts`** | **`buildItemsForQuestion`** (sentinel rows) shared by **`tool.ts`**.                                                                                                                                            |
| **`events.ts`**      | **`ask_user_question:prompt`** payload (per-option **`hasPreview`**, no preview body).                                                                                                                          |

## vs upstream rpiv

- **Mounting**: rpiv used **`ctx.ui.custom(..., { overlay: true, ... })`**; this package uses **editor-slot-only** `custom(factory)` (see [PHASE0.md](../../docs/ask-user-question/PHASE0.md)). Re-validate layout on your Pi build (**EXECUTION-STEPS P2-12**).
- **Copy / strings**: UI strings are **inline English** in components and **`ROW_INTENT_META`** (no **`rpiv-i18n`**).
- **Events**: channel name is **`ask_user_question:prompt`** (not **`rpiv:ask-user:prompt`**) so it matches the tool id in this monorepo; payload shape follows the upstream summary (including **`options[]`** with **`hasPreview`**).

`content[0].text` and `details` for success / validation / `no_ui` follow **`buildToolResult` / `buildQuestionnaireResponse`** as in rpiv.
