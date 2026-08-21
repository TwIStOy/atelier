import type { QuestionData, QuestionParams } from "./types.ts";

/**
 * Control characters that garble terminal output when rendered: C0 except
 * tab (\u0009) and newline (\u000A), DEL, and the C1 range (includes CSI
 * \u009B and other terminal-escape bytes that appear in mojibake text).
 * Carriage return is handled separately to normalize `\r\n` first.
 */
const TERMINAL_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * Strip terminal-control characters from model-authored text.
 *
 * LLM tool calls occasionally emit stray `\r` spam (e.g. repeated CR bytes
 * inside `description` strings) and other control characters. `visibleWidth`
 * counts them as 0 columns, so width math stays "correct" while the terminal
 * interprets a bare CR as cursor-to-column-0 and repaints over the line —
 * garbling the whole dialog. Only `\t` and `\n` survive.
 */
export function sanitizeModelText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "").replace(TERMINAL_CONTROL_RE, "");
}

function sanitizeOption(o: QuestionData["options"][number]): QuestionData["options"][number] {
  return {
    label: sanitizeModelText(o.label),
    description: sanitizeModelText(o.description),
    ...(o.preview !== undefined ? { preview: sanitizeModelText(o.preview) } : {}),
  };
}

function sanitizeQuestion(q: QuestionData): QuestionData {
  return {
    question: sanitizeModelText(q.question),
    header: sanitizeModelText(q.header),
    options: q.options.map(sanitizeOption),
    ...(q.multiSelect !== undefined ? { multiSelect: q.multiSelect } : {}),
  };
}

/**
 * Sanitize every text field of `QuestionParams`. Pure — returns a new object,
 * never mutates the input. Run before validation so duplicate detection sees
 * CR-stripped text.
 */
export function sanitizeQuestionnaire(params: QuestionParams): QuestionParams {
  return { questions: params.questions.map(sanitizeQuestion) };
}
