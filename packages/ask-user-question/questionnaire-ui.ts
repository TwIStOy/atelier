import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type {
  QuestionAnswer,
  QuestionData,
  QuestionnaireResult,
  QuestionParams,
} from "./tool/types.ts";
import { SENTINEL_LABELS } from "./tool/types.ts";

type TUILike = { requestRender(): void };

function hasAnyPreview(question: QuestionData): boolean {
  return question.options.some(
    (o) => typeof o.preview === "string" && o.preview.trim().length > 0,
  );
}

function sentinelSubmitLabel(isLastQuestion: boolean): string {
  return isLastQuestion ? "Submit" : SENTINEL_LABELS.next;
}

export function createQuestionnaireComponent(
  params: QuestionParams,
  theme: Theme,
  tui: TUILike,
  done: (r: QuestionnaireResult) => void,
): Component & { handleInput(data: string): void } {
  let questionIndex = 0;
  let rowIndex = 0;
  const answers: QuestionAnswer[] = [];
  let multiChecked = new Set<number>();
  let cacheW: number | undefined;
  let cacheLines: string[] | undefined;

  const invalidate = () => {
    cacheW = undefined;
    cacheLines = undefined;
  };

  const currentQuestion = (): QuestionData => params.questions[questionIndex]!;
  const optionCount = (): number => currentQuestion().options.length;
  const isMulti = (): boolean => currentQuestion().multiSelect === true;
  const lastRowIndex = (): number => optionCount();
  const isLastQuestion = (): boolean =>
    questionIndex + 1 >= params.questions.length;

  const finishChat = () => {
    const q = currentQuestion();
    answers.push({
      questionIndex,
      question: q.question,
      kind: "chat",
      answer: null,
    });
    done({ answers, cancelled: false });
  };

  const finishSingleOption = (optIdx: number) => {
    const q = currentQuestion();
    const opt = q.options[optIdx]!;
    const answer: QuestionAnswer = {
      questionIndex,
      question: q.question,
      kind: "option",
      answer: opt.label,
    };
    if (typeof opt.preview === "string" && opt.preview.length > 0) {
      answer.preview = opt.preview;
    }
    answers.push(answer);
    if (isLastQuestion()) {
      done({ answers, cancelled: false });
      return;
    }
    questionIndex++;
    rowIndex = 0;
    multiChecked = new Set();
    invalidate();
    tui.requestRender();
  };

  const finishMulti = () => {
    const q = currentQuestion();
    const selected = [...multiChecked]
      .sort((a, b) => a - b)
      .map((i) => q.options[i]!.label);
    answers.push({
      questionIndex,
      question: q.question,
      kind: "multi",
      answer: null,
      selected,
    });
    if (isLastQuestion()) {
      done({ answers, cancelled: false });
      return;
    }
    questionIndex++;
    rowIndex = 0;
    multiChecked = new Set();
    invalidate();
    tui.requestRender();
  };

  return {
    render(width: number) {
      if (cacheW === width && cacheLines) return cacheLines;
      const q = currentQuestion();
      const lines: string[] = [];
      const add = (s: string) => lines.push(truncateToWidth(s, width));
      add(theme.fg("accent", "─".repeat(Math.max(1, width))));
      add(
        theme.fg(
          "muted",
          ` ${truncateToWidth(q.header, Math.max(4, width - 2))}`,
        ),
      );
      for (const row of wrapTextWithAnsi(
        theme.fg("text", ` ${q.question}`),
        width - 2,
      )) {
        add(row);
      }
      add("");
      const multi = isMulti();
      const oc = optionCount();
      for (let i = 0; i < oc; i++) {
        const o = q.options[i]!;
        const focused = rowIndex === i;
        const sel = focused ? theme.fg("accent", ">") : " ";
        if (multi) {
          const box = multiChecked.has(i)
            ? theme.fg("accent", "[✔]")
            : theme.fg("muted", "[ ]");
          add(
            `${sel} ${box} ${theme.fg(focused ? "accent" : "text", `${i + 1}. ${o.label}`)}`,
          );
        } else {
          add(
            `${sel}  ${theme.fg(focused ? "accent" : "text", `${i + 1}. ${o.label}`)}`,
          );
        }
        if (o.description) {
          const ind = multi ? "     " : "   ";
          for (const drow of wrapTextWithAnsi(
            theme.fg("muted", o.description),
            width - ind.length,
          )) {
            add(`${ind}${drow}`);
          }
        }
      }
      const sentinelRow = oc;
      if (multi) {
        const focused = rowIndex === sentinelRow;
        const sel = focused ? theme.fg("accent", ">") : " ";
        const label = sentinelSubmitLabel(isLastQuestion());
        add(
          `${sel}  ${theme.fg(focused ? "accent" : "text", `${label} — confirm selection`)}`,
        );
      } else {
        const focused = rowIndex === sentinelRow;
        const sel = focused ? theme.fg("accent", ">") : " ";
        add(
          `${sel}  ${theme.fg(focused ? "accent" : "text", SENTINEL_LABELS.chat)}`,
        );
      }
      if (!multi && hasAnyPreview(q)) {
        add("");
        if (rowIndex < oc) {
          const fo = q.options[rowIndex]!;
          const pv =
            typeof fo.preview === "string" && fo.preview.length > 0
              ? fo.preview
              : "";
          if (pv.length > 0) {
            add(
              theme.fg("dim", " Preview (text, Phase 2 — Markdown pane TBD):"),
            );
            const pvLines = pv.split("\n").slice(0, 8);
            for (const pl of pvLines) {
              for (const w of wrapTextWithAnsi(
                theme.fg("muted", pl),
                width - 2,
              )) {
                add(`  ${w}`);
              }
            }
          }
        } else {
          add(
            theme.fg(
              "dim",
              " Chat row — Enter abandons structured answers for this topic.",
            ),
          );
        }
      }
      add("");
      const hint = multi
        ? ` Question ${questionIndex + 1}/${params.questions.length} (multi) · ↑↓ · Space toggle · Enter on ${sentinelSubmitLabel(isLastQuestion())} · Esc cancel`
        : ` Question ${questionIndex + 1}/${params.questions.length} · ↑↓ · Enter confirm · Esc cancel`;
      add(theme.fg("dim", hint));
      add(theme.fg("accent", "─".repeat(Math.max(1, width))));
      cacheW = width;
      cacheLines = lines;
      return lines;
    },
    invalidate,
    handleInput(data: string) {
      if (matchesKey(data, Key.escape)) {
        done({ answers: [], cancelled: true });
        return;
      }
      const oc = optionCount();
      const sentinel = oc;
      const multi = isMulti();
      if (matchesKey(data, Key.up)) {
        rowIndex = Math.max(0, rowIndex - 1);
        invalidate();
        tui.requestRender();
        return;
      }
      if (matchesKey(data, Key.down)) {
        rowIndex = Math.min(sentinel, rowIndex + 1);
        invalidate();
        tui.requestRender();
        return;
      }
      if (multi && matchesKey(data, Key.space)) {
        if (rowIndex < oc) {
          const next = new Set(multiChecked);
          if (next.has(rowIndex)) next.delete(rowIndex);
          else next.add(rowIndex);
          multiChecked = next;
          invalidate();
          tui.requestRender();
        }
        return;
      }
      if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
        if (multi) {
          if (rowIndex === sentinel) finishMulti();
          return;
        }
        if (rowIndex === sentinel) {
          finishChat();
          return;
        }
        finishSingleOption(rowIndex);
      }
    },
  };
}
