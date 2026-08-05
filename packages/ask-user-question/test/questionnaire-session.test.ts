import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { QuestionnaireSession } from "../src/state/questionnaire-session.ts";
import type { QuestionnaireResult, QuestionParams } from "../src/tool/types.ts";
import type { WrappingSelectItem } from "../src/view/components/wrapping-select.ts";

const DOWN = "\x1b[B";
const ENTER = "<ENTER>";
const CTRL_G = "\x07";

const params: QuestionParams = {
  questions: [
    {
      question: "Which?",
      header: "Pick",
      options: [
        { label: "A", description: "a" },
        { label: "B", description: "b" },
      ],
    },
  ],
};

function itemsFor(value: QuestionParams): WrappingSelectItem[][] {
  return value.questions.map((q) => [
    ...q.options.map((o) => ({ kind: "option" as const, label: o.label, description: o.description })),
    { kind: "other" as const, label: "Type something." },
  ]);
}

/** Minimal resolver: each named binding maps to one concrete data byte; everything else falls through to ignore. */
function fakeKeybindings() {
  return {
    matches(data: string, name: string): boolean {
      switch (name) {
        case "tui.select.down":
          return data === DOWN;
        case "tui.select.confirm":
          return data === ENTER;
        case "app.editor.external":
          return data === CTRL_G;
        default:
          return false;
      }
    },
  };
}

const PLAIN_THEME = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flush the session's `.then` continuation that `runEffect` attaches to `editInput`. */
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

interface MakeSessionOptions {
  editInput?: (value: string) => Promise<string | undefined>;
}

function makeSession(options: MakeSessionOptions = {}) {
  const editInput = options.editInput ?? vi.fn(async () => undefined);
  const done = vi.fn<(result: QuestionnaireResult) => void>();
  const session = new QuestionnaireSession({
    tui: { terminal: { columns: 120, rows: 40 }, requestRender: vi.fn() },
    theme: PLAIN_THEME,
    params,
    itemsByTab: itemsFor(params),
    keybindings: fakeKeybindings(),
    editInput,
    done,
  });
  return { session, done, editInput };
}

/** Focus the "Type something." row (index 2: option, option, other) to switch inputMode on. */
function focusCustomRow(session: QuestionnaireSession): void {
  session.component.handleInput(DOWN);
  session.component.handleInput(DOWN);
}

describe("QuestionnaireSession — external editor wiring", () => {
  it("launches the editor with the current draft on Ctrl+G", () => {
    const editInput = vi.fn(async () => undefined);
    const { session } = makeSession({ editInput });
    focusCustomRow(session);
    session.component.handleInput("a");
    session.component.handleInput("b");
    session.component.handleInput("c");

    session.component.handleInput(CTRL_G);

    expect(editInput).toHaveBeenCalledExactlyOnceWith("abc");
  });

  it("writes the editor result back and submits it on Enter", async () => {
    const draft = deferred<string | undefined>();
    const editInput = vi.fn(() => draft.promise);
    const { session, done } = makeSession({ editInput });
    focusCustomRow(session);
    session.component.handleInput("x");

    session.component.handleInput(CTRL_G);
    draft.resolve("edited");
    await flushMicrotasks();

    session.component.handleInput(ENTER);

    expect(done).toHaveBeenCalledOnce();
    const result = done.mock.calls[0]![0];
    expect(result.cancelled).toBe(false);
    expect(result.answers[0]).toMatchObject({ kind: "custom", answer: "edited" });
  });

  it("ignores further input while the editor is open (reentry guard)", () => {
    const draft = deferred<string | undefined>();
    const editInput = vi.fn(() => draft.promise);
    const { session } = makeSession({ editInput });
    focusCustomRow(session);

    session.component.handleInput(CTRL_G);
    session.component.handleInput(CTRL_G);
    session.component.handleInput("z");

    expect(editInput).toHaveBeenCalledOnce();
  });

  it("retains the original draft when the editor reports a launch failure", async () => {
    const draft = deferred<string | undefined>();
    const editInput = vi.fn(() => draft.promise);
    const { session, done } = makeSession({ editInput });
    focusCustomRow(session);
    session.component.handleInput("k");

    session.component.handleInput(CTRL_G);
    draft.reject(new Error("editor failed"));
    await flushMicrotasks();

    session.component.handleInput(ENTER);

    const result = done.mock.calls[0]![0];
    expect(result.answers[0]).toMatchObject({ kind: "custom", answer: "k" });
  });

  it("retains the draft when editInput resolves undefined (host-reported launch failure)", async () => {
    // Production tool.ts wraps the editor in try/catch and resolves `undefined` on any
    // failure (notify + keep draft) rather than rejecting — exercise that contract too.
    const draft = deferred<string | undefined>();
    const editInput = vi.fn(() => draft.promise);
    const { session, done } = makeSession({ editInput });
    focusCustomRow(session);
    session.component.handleInput("k");

    session.component.handleInput(CTRL_G);
    draft.resolve(undefined);
    await flushMicrotasks();

    session.component.handleInput(ENTER);

    const result = done.mock.calls[0]![0];
    expect(result.answers[0]).toMatchObject({ kind: "custom", answer: "k" });
  });
});
