# 0002: Pointer support for the questionnaire dialog

**Status**: accepted

The questionnaire modal was keyboard-only: tabs, option rows, and the submit picker all rendered plain text lines with no hit-testing, so a mouse click did nothing. pi-tui can deliver clicks to extension components, but only in fullscreen mode — `tui-alt-screen.js` is the only renderer that enables terminal mouse reporting (`?1000`/`?1002`/`?1003` + `?1006`); regular mode leaves the pointer to the terminal because the terminal owns scrollback. Mouse support therefore cannot be uniform, and any design that assumes clicks exist would break the common inline case.

## Decision

Five coupled choices:

1. **Fullscreen-only, keyboard-first** — components implement `handleMouse` and act on clicks, but nothing in the dialog depends on the pointer. The keyboard path is unchanged, and regular mode simply never receives events.
2. **Click means "focus, then act"** — a click on a single-select option focuses it and commits it; a multi-select option toggles; the `Type something.` sentinel only focuses (its commit path is typing); the `Next` row commits the question; submit-picker rows submit or cancel; tab clicks switch tabs. This is expressed as an *action sequence* (`routePointer` → `QuestionnaireAction[]`) instead of new action kinds, because the reducer builds answers from the focused row (`runtime.currentItem`), so focus must be committed before the commit action.
3. **Row attribution stays in `DialogView`** — the final painted rows are the container's natural rows after overflow clipping and scroll windowing, so the container's own child layout is not valid screen geometry. `DialogView` records `rowMap: finalRow → naturalRow` (with `-1` for residual spacer rows and `↑`/`↓` markers) and forwards the click to `Container.handleMouse` in natural coordinates, letting pi-tui route it to the child that owns the row. Children never compute absolute screen positions.
4. **Two-phase press/click protocol** — pi synthesizes the `click` event only when the matching `press` was claimed, so a clickable region claims presses (`{ handled: true, render: false }`) and acts on the click. Acting on `press` would fire during a drag, and repeat clicks (`clickCount > 1`) are ignored so a double click cannot toggle a row twice.
5. **On-demand hit-testing, not render-time maps** — every clickable region recomputes its rows from state at click time (`WrappingSelect.itemAt`, `MultiSelectView.optionIndexAtRow`, `TabBar.layout`), reusing the same row math the renderer uses. Render-time maps would be clobbered by the height-measurement renders (`getBodyHeight`, `naturalHeight`) that run at different widths in the same frame.

## Considered options

- **Build a click table during `render`** — rejected: the dialog measures body heights by re-rendering children at other widths every frame (`PreviewPane.bodyHeight`, `DialogView.render`'s spacer math), so the last render before a click is not necessarily the painted one.
- **Hit-test on the whole dialog and skip `Container`** — rejected: it would re-implement per-child row offsets and silently desync from the container's own child order the next time a chrome row is added.
- **Act on `press` instead of `click`** — rejected: text-selection drags that start on a row would activate it, and the framework's click synthesis (which already suppresses moved gestures) would be bypassed.
- **Emit one composite reducer action (`pointer_option`)** — rejected: it duplicates the answer-building branches already in the key path. A sequence of existing actions shares one state machine, at the cost of a `commitAll` loop that re-reads runtime between actions.
- **Map clicks to `ctx.ui` native dialogs (e.g. `ui.select`) in fullscreen** — rejected: it loses previews, multi-select, and per-question tabs, which are the dialog's reason to exist.

## Consequences

- `@htwang-contrib/common` gains `tui-click.ts` (`ClickSpan`, `spanAt`, `dispatchClick`) — the two-phase protocol is subtle enough that every clickable extension component should share one implementation.
- Every clickable region needs a stable row model. Changing how a component wraps, pads, or windows rows now also changes what a click hits; the components keep render and hit-testing inside the same helper (`TabBar.layout`, `computeItemRowCount`) so they cannot drift apart.
- The dialog keeps working if `handleMouse` is never called: no state is pointer-only, and the `blocked` program-status message still reflects the modal.
- Behaviour differs by mode. Documentation and hints must not promise clicking, because regular mode has no pointer events at all.
