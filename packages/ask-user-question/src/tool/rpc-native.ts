import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { OptionData, QuestionAnswer, QuestionData, QuestionnaireResult, QuestionParams } from "./types.ts";

const MULTI_SELECT_PROMPT = "Enter comma-separated option numbers (e.g. 1,3).";

/**
 * Drive the questionnaire one question at a time via the RPC host's native
 * dialog sub-protocol (`ctx.ui.select` / `ctx.ui.input`). Mirrors the TUI
 * `QuestionnaireResult` shape so `buildQuestionnaireResponse` produces an
 * identical envelope. The first cancelled dialog cancels the whole run —
 * matching TUI Esc semantics.
 *
 * Degradations vs the TUI side-by-side UI (per the upstream trade-off):
 * - single-select keeps the native dropdown; option previews are folded into
 *   the title since the native dropdown cannot render a preview pane.
 * - multi-select degrades to a comma-separated-index text input.
 */
export async function runRpcQuestionnaire(
  ui: ExtensionUIContext,
  params: QuestionParams,
): Promise<QuestionnaireResult> {
  const answers: QuestionAnswer[] = [];
  for (let i = 0; i < params.questions.length; i++) {
    const question = params.questions[i];
    const answer =
      question.multiSelect === true ? await askMultiSelect(ui, i, question) : await askSingleSelect(ui, i, question);
    if (answer === null) return { answers, cancelled: true };
    answers.push(answer);
  }
  return { answers, cancelled: false };
}

async function askSingleSelect(
  ui: ExtensionUIContext,
  index: number,
  question: QuestionData,
): Promise<QuestionAnswer | null> {
  const displays = question.options.map(formatOptionLabel);
  const choice = await ui.select(buildSingleSelectTitle(question), displays);
  if (choice === undefined) return null;
  // Hosts answer in one of three shapes: the bare option label (hosts that
  // render their own UI from the tool args), the full display string
  // (generic dropdown hosts), or free text via their "Type something."
  // affordance. Only the first two resolve to an option; anything else is a
  // custom answer, never a cancellation.
  const option = question.options.find((o) => o.label === choice) ?? question.options[displays.indexOf(choice)];
  if (option) {
    return {
      questionIndex: index,
      question: question.question,
      kind: "option",
      answer: option.label,
      preview: previewText(option),
    };
  }
  return {
    questionIndex: index,
    question: question.question,
    kind: "custom",
    answer: choice,
  };
}

async function askMultiSelect(
  ui: ExtensionUIContext,
  index: number,
  question: QuestionData,
): Promise<QuestionAnswer | null> {
  const raw = await ui.input(buildMultiSelectTitle(question), MULTI_SELECT_PROMPT);
  if (raw === undefined) return null;
  const selected = parseIndices(raw, question.options.length).map((i) => question.options[i].label);
  return {
    questionIndex: index,
    question: question.question,
    kind: "multi",
    answer: null,
    selected,
  };
}

function buildSingleSelectTitle(question: QuestionData): string {
  const previews = question.options
    .map((o) => ({ label: o.label, preview: previewText(o) }))
    .filter((o): o is { label: string; preview: string } => o.preview !== undefined);
  if (previews.length === 0) return question.question;
  const block = previews.map((p) => `[${p.label}]\n${p.preview.trim()}`).join("\n\n");
  return `${question.question}\n\n${block}`;
}

function buildMultiSelectTitle(question: QuestionData): string {
  const lines = question.options.map((o, i) => {
    const base = `${i + 1}. ${formatOptionLabel(o)}`;
    const preview = previewText(o);
    return preview ? `${base}\n    ${preview.trim().replace(/\n/g, "\n    ")}` : base;
  });
  return `${question.question}\n\n${lines.join("\n")}`;
}

function parseIndices(raw: string, max: number): number[] {
  const out: number[] = [];
  for (const part of raw.split(/[,\s]+/)) {
    if (part.length === 0) continue;
    const n = Number.parseInt(part, 10);
    if (Number.isInteger(n) && n >= 1 && n <= max) out.push(n - 1);
  }
  return [...new Set(out)];
}

function previewText(o: OptionData): string | undefined {
  return typeof o.preview === "string" && o.preview.length > 0 ? o.preview : undefined;
}

function formatOptionLabel(o: OptionData): string {
  return o.description ? `${o.label} — ${o.description}` : o.label;
}
