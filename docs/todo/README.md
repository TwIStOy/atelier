# Todo Extension — Port Documentation

> Port of [rpiv-todo](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo) into the `@htwang-contrib` monorepo as `packages/todo`.

## Documents

- **[MODULES.md](./MODULES.md)** — 每个模块的实现规格：导出、签名、行为、校验规则、依赖、移植动作（PORT/ADAPT/REWRITE）、测试覆盖。实现时的逐模块参照表。
- **[SOURCE-ANALYSIS.md](./SOURCE-ANALYSIS.md)** — 上游架构、数据流、逐文件 before/after（rpiv → 本 monorepo 的改动片段）。reference catalog。
- **[DESIGN.md](./DESIGN.md)** — 端口设计：包结构、关键决策、模块职责一览、测试策略、package 配置。
- **[STEPS.md](./STEPS.md)** — 分阶段实施 checklist（Phase 0–6），每步对应模块与设计章节。

> 四份文档的关系：MODULES = 「做成什么样」（what），DESIGN = 「为什么这么定」（why），SOURCE-ANALYSIS = 「上游长啥样/改哪」（reference），STEPS = 「按什么顺序做」（how/when）。

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
