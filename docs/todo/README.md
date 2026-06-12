# Todo Extension — Port Documentation

> Port of [rpiv-todo](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo) into the `@htwang-contrib` monorepo as `packages/todo`.

## Documents

- **[SOURCE-ANALYSIS.md](./SOURCE-ANALYSIS.md)** — Upstream architecture, data flow, and a per-file port mapping (what each file does, what we change, before/after snippets). The reference catalog.
- **[DESIGN.md](./DESIGN.md)** — Our port's design: package structure, key decisions, module responsibilities, test strategy, and package config.
- **[STEPS.md](./STEPS.md)** — Step-by-step implementation checklist (the execution plan).

## Quick Summary

| Topic                      | Decision                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------- |
| i18n                       | **Drop** — no equivalent infrastructure. Inline English strings.                      |
| Config                     | **Replace** — use `readConfig` from `@htwang-contrib/common`.                         |
| TypeBox                    | **Replace** — use `@sinclair/typebox`, `Type.Union` instead of `StringEnum`.          |
| Stale ctx guard            | **Reuse** — `isStaleCtxError` from `@htwang-contrib/common`.                          |
| State layer                | **Port as-is** — reducer, store, selectors, replay, invariants, task-graph unchanged. |
| Backward-compat re-exports | **Drop** — no legacy consumers in this monorepo.                                      |
| Package name               | `@htwang-contrib/todo`                                                                |
| Tool name                  | `todo` (unchanged)                                                                    |
