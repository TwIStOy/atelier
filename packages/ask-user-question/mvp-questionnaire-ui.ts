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

type TUILike = { requestRender(): void };

export function createMvpQuestionnaireComponent(
  params: QuestionParams,
  theme: Theme,
  tui: TUILike,
  done: (r: QuestionnaireResult) => void,
): Component & { handleInput(data: string): void } {
  let questionIndex = 0;
  let optionIndex = 0;
  const answers: QuestionAnswer[] = [];
  let cacheW: number | undefined;
  let cacheLines: string[] | undefined;

  const invalidate = () => {
    cacheW = undefined;
    cacheLines = undefined;
  };

  const currentQuestion = (): QuestionData => params.questions[questionIndex]!;

  const confirmOption = () => {
    const q = currentQuestion();
    const opt = q.options[optionIndex]!;
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
    if (questionIndex + 1 >= params.questions.length) {
      done({ answers, cancelled: false });
      return;
    }
    questionIndex++;
    optionIndex = 0;
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
      for (const row of wrapTextWithAnsi(
        theme.fg("text", ` ${q.question}`),
        width - 2,
      )) {
        add(row);
      }
      add("");
      q.options.forEach((o, i) => {
        const sel = i === optionIndex ? theme.fg("accent", ">") : " ";
        add(
          `${sel}  ${theme.fg(i === optionIndex ? "accent" : "text", `${i + 1}. ${o.label}`)}`,
        );
        if (o.description) {
          const ind = "   ";
          for (const drow of wrapTextWithAnsi(
            theme.fg("muted", o.description),
            width - ind.length,
          )) {
            add(`${ind}${drow}`);
          }
        }
      });
      add("");
      add(
        theme.fg(
          "dim",
          ` Question ${questionIndex + 1}/${params.questions.length} · ↑↓ choose · Enter confirm · Esc cancel`,
        ),
      );
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
      const q = currentQuestion();
      if (matchesKey(data, Key.up)) {
        optionIndex = Math.max(0, optionIndex - 1);
        invalidate();
        tui.requestRender();
        return;
      }
      if (matchesKey(data, Key.down)) {
        optionIndex = Math.min(q.options.length - 1, optionIndex + 1);
        invalidate();
        tui.requestRender();
        return;
      }
      if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
        confirmOption();
      }
    },
  };
}
