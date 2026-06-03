# Phase 0 — API lock and UI probe

This document satisfies **P0-1** (version lock + type source), **P0-2** (minimal `ctx.ui.custom` probe), and **P0-3** (adapter notes) from [EXECUTION-STEPS.md](./EXECUTION-STEPS.md).

## Where the UI mounts

This package uses **`ctx.ui.custom(factory)` only** — no second-argument options object. In Pi interactive mode the component is placed in **`editorContainer`** (the prompt **editor** region); draft input is restored after `done()`. Same pattern as [ghoseb/pi-askuserquestion](https://github.com/ghoseb/pi-askuserquestion).

Free-text in a full implementation can still embed **`pi-tui` `Editor`** inside that component tree. We do **not** use `setEditorComponent` for the questionnaire flow (`setEditorComponent` replaces the shell editor factory for the whole session).

## P0-1 — Locked versions (workspace install)

Record the resolved versions after `npm install` at the repo root (hoisted `node_modules`):

```bash
npm ls @earendil-works/pi-coding-agent @earendil-works/pi-tui @earendil-works/pi-ai --depth=0
```

At the time this Phase 0 landed in-tree, `npm ls … --depth=0` resolved:

- **`@earendil-works/pi-coding-agent@0.76.0`**
- **`@earendil-works/pi-tui@0.76.0`**
- **`@earendil-works/pi-ai@0.76.0`** (root devDependency; used by other packages at mixed minors — re-run `npm ls` after upgrades).

### Type sources to keep open while porting

- **`ExtensionContext`**: `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` — `hasUI`, `ui`.
- **`ExtensionUIContext.custom`**: same file — factory signature, `done`, return `Promise<T>`.

## P0-2 — Minimal probe in-repo

Package: **`packages/ask-user-question/`** — command **`/auq-phase0`**.

- When **`ctx.hasUI`** is true: `await ctx.ui.custom(...)` with **only the factory** (editor slot).
- Factory returns a **`Box`** + **`Text`** wrapper that implements **`handleInput`**; **Enter** (`\r` / `\n`) calls **`done({ probe: "auq_phase0", dismissedBy: "enter" })`**.
- After the promise resolves, **`ctx.ui.notify(..., "info")`** shows the JSON payload so you can confirm **`done` resolves the outer `await`** and the default editor is restored.

**Manual acceptance:** the probe replaces the bottom prompt editor, keyboard reaches the component, one Enter calls `done`, editor returns with prior draft text, notification shows.

## P0-3 — Adapter backlog (Pi vs rpiv port)

Thin shims when migrating **`ask-user-question.ts`** and **`view/`** from rpiv:

| Topic                                | rpiv / notes              | This Pi port                                                                                               |
| ------------------------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **`custom` factory args**            | `(tui, theme, _kb, done)` | Same four parameters; third is **`KeybindingsManager`**.                                                   |
| **`Theme` in factory**               | Interactive session theme | **`Theme`** from Pi — not `EditorTheme` from `setEditorComponent`.                                         |
| **`setEditorComponent` vs `custom`** | —                         | Questionnaire uses **`custom` + editor slot** only; do not switch the global editor factory for this tool. |
| **`getMarkdownTheme` / `Markdown`**  | Preview path              | From **`@earendil-works/pi-coding-agent`**; align with **`@earendil-works/pi-tui`** `Markdown` (Phase 2).  |
| **`Input` cursor**                   | Private field reflection  | Pi upgrade risk — watch for a public cursor API.                                                           |

Rpiv historically mounted the questionnaire in a **floating overlay**; this port **re-targets the same component tree to the editor slot**, so layout, height, and any `OverlayHandle`-style tricks from rpiv need a single-slot redesign rather than a second code path.
