/**
 * Helpers for layering custom editor factories without clobbering each other.
 *
 * Pi exposes a single editor slot (`ctx.ui.setEditorComponent`). When multiple
 * extensions want to layer behavior onto the editor (e.g. `statusline` draws a
 * decorated border, `user-input-history` adds prompt history, `double-escape`
 * intercepts Escape), each must wrap the currently-registered factory and
 * delegate to it for the inner editor instance — otherwise the last writer
 * wins and earlier decorators silently disappear.
 *
 * `chainEditorFactory` records the immediate parent factory on the wrapper so
 * chains compose regardless of registration order. Callers do:
 *
 * ```ts
 * ctx.ui.setEditorComponent(
 *   chainEditorFactory(ctx.ui.getEditorComponent(), (parent) => (tui, theme, kb) => {
 *     const inner = parent ? parent(tui, theme, kb) : new CustomEditor(tui, theme, kb);
 *     // ...layer behavior on inner...
 *     return inner;
 *   }),
 * );
 * ```
 */

const PARENT_KEY = "__piExtensionsEditorChainParent" as const;

type ChainedFactory<F> = F & { [PARENT_KEY]?: F };

/**
 * Wrap the current editor factory. `wrap` receives the immediate parent
 * factory (or `undefined` when no custom editor is registered) and must return
 * a factory that builds the composed editor, delegating to `parent` for the
 * inner instance.
 */
export function chainEditorFactory<F>(current: F | undefined, wrap: (parent: F | undefined) => F): F {
  const factory = wrap(current) as ChainedFactory<F>;
  factory[PARENT_KEY] = current;
  return factory;
}

/**
 * Get the immediate parent factory recorded by `chainEditorFactory`, or
 * `undefined` if `factory` was not produced by it.
 */
export function getEditorFactoryParent<F>(factory: F | undefined): F | undefined {
  return (factory as ChainedFactory<F> | undefined)?.[PARENT_KEY];
}
