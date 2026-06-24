import { ROW_INTENT_META, sentinelsToAppend } from "./state/row-intent.ts";
import type { QuestionData } from "./tool/types.ts";
import type { WrappingSelectItem } from "./view/components/wrapping-select.ts";

export function buildItemsForQuestion(question: QuestionData): WrappingSelectItem[] {
  const items: WrappingSelectItem[] = question.options.map((o) => ({
    kind: "option",
    label: o.label,
    description: o.description,
  }));
  const hasAnyPreview = question.options.some((o) => typeof o.preview === "string" && o.preview.length > 0);
  for (const kind of sentinelsToAppend(question, hasAnyPreview)) {
    items.push({ kind, label: ROW_INTENT_META[kind].label });
  }
  return items;
}
