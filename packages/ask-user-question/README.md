# ask-user-question

Port of structured questionnaire tooling from [rpiv-ask-user-question](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question). Work is staged per [docs/ask-user-question/EXECUTION-STEPS.md](../../docs/ask-user-question/EXECUTION-STEPS.md).

## Phase 0 manual check

With this repo on your `pi.extensions` list, start interactive Pi and run:

`/auq-phase0`

The probe calls **`ctx.ui.custom(factory)`** with no options object, so the UI appears in the **prompt editor region** (same as [ghoseb/pi-askuserquestion](https://github.com/ghoseb/pi-askuserquestion)). Press Enter to call `done`; Pi restores the normal editor and shows an info notification with the JSON result.

See [docs/ask-user-question/PHASE0.md](../../docs/ask-user-question/PHASE0.md) for locked dependency versions and porting notes.

## Tool layer (P1-1)

`packages/ask-user-question/tool/` — TypeBox **`QuestionParamsSchema`**, **`validateQuestionnaire`**, **`buildQuestionnaireResponse`** / **`buildAnswerSegment`**, **`formatAnswerScalar`**. `types.ts` inlines sentinel labels (aligned with rpiv `ROW_INTENT_META`) so this step does not depend on `state/row-intent.ts` yet.
