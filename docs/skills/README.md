# 工程类 Skills 使用指南

一组从 [`mattpocock/skills`](https://github.com/mattpocock/skills)(MIT)移植、并适配到本仓库 pi 约定的工作流 skill,外加一个 prompt。它们针对编码 agent 的四种失败模式:没做你想要的、太啰嗦、产出坏代码、把代码搞成泥球。

> 本文件按用户要求用中文撰写,是仓库全局「文档须英文」规则的一个**作用域例外,仅限本文件**。其余文档仍遵循英文规则。

本文是操作手册——每个 skill 干什么、怎么触发、彼此如何咬合。运行时 agent 加载的是各 skill 自己的 `SKILL.md`(那才是事实来源);本文是面向人的索引。

## 两种触发方式

| 类型 | 如何触发 | 成员 |
|---|---|---|
| **Skill**(model-invoked) | 正常说话——agent 把你的请求和每个 skill 的 `description` 做语义匹配,自动加载。不需要斜杠命令。 | `grilling`、`domain-modeling`、`tdd`、`code-review`、`diagnosing-bugs`、`write-a-skill` |
| **Prompt**(user-invoked) | 显式打 `/command`。只能手动触发。 | `/grill-with-docs` |

触发是**语义匹配**,所以中文英文都行——但英文关键词最稳。拿不准就直接点名:"用 tdd skill 来做"。

## 这些 skill

### `grilling` —— 动手前盘问方案

- **触发词**:"stress-test this plan"、"grill me"、"challenge this design"、"interrogate this idea"、"盘问一下这个方案"。
- **何时用**:想法还模糊,想在碰代码前被交叉盘问到清晰。
- **纪律**:一次只问一个问题,每个都给推荐答案;能自己查代码查到的就不问你;在你确认达成共识前不会动手执行方案。
- **无状态**:不向磁盘写任何东西。

### `domain-modeling` —— 固定项目的统一语言

- **触发词**:"pin down this term"、"sharpen the domain language"、"record an architectural decision"、"CONTEXT.md"、"ADR"、"统一术语"、"记个架构决策"。
- **何时用**:项目词汇 slippery,或你即将做一个值得记录的、难撤销的决策。
- **产物**:`CONTEXT.md`(一份词汇表——鲜明的正典术语配 `_Avoid_` 同义词,不含实现细节)和 `docs/adr/NNNN-slug.md`(1–3 句的决策记录)。
- **纪律**:术语一敲定就当场记下(绝不攒批);只有三个条件**全满足**才提 ADR——难撤销、没上下文会让人困惑、是真有取舍的结果。

### `/grill-with-docs` —— 边盘问边建领域模型

- **怎么用**:打 `/grill-with-docs`。
- **何时用**:同 `grilling`,但带着代码库——你想让盘问同时持久化一份共享词汇。
- **机制**:一个薄 prompt,组合 `grilling` 和 `domain-modeling` 两个 skill,告诉 agent 加载两者的 `SKILL.md` 并一起应用。

### `tdd` —— 值得留的测试驱动开发

- **触发词**:"use TDD for X"、"test-first"、"red-green-refactor"、"integration tests"、"用 TDD 做 X"。
- **何时用**:做新功能或修 bug,想要能扛重构的测试。
- **纪律**:
  1. **先约定 seam** —— 写任何测试前,列出要测的公开边界并和用户确认。未确认的 seam 上不准写测试。
  2. **红 → 绿** —— 先写失败的测试,再写刚够让它过的代码。
  3. **纵切** —— 一个测试 → 一个实现 → 循环;每个测试是发曳光弹(tracer bullet),响应上一轮学到的东西。
  4. **重构不在这个循环里** —— 它归 `code-review` 阶段。
- **它标记的反模式**:implementation-coupled(重构就红)、tautological(按构造必过)、horizontal slicing(测的是想象中的行为)。见 `skills/tdd/references/{tests,mocking}.md`。

### `code-review` —— 双轴并行评审

- **触发词**:"review since main"、"review this branch"、"code review"、"看看这次的改动"、"review this PR"。
- **何时用**:一批改动做完了,想系统评审。
- **机制**:先钉一个固定点(commit/branch/tag/merge-base),然后通过 `subagent` 工具**并行起两个子 agent**——
  - **Standards**:这批 diff 是否遵循仓库已文档化的标准(`AGENTS.md`、`CODING_STANDARDS.md`、……)外加一份固定的 12 味 Fowler 基线?
  - **Spec**:这批 diff 是否忠实实现了原始的 issue/PRD?
  两份报告并排呈现,故意**不合并、不重排**。
- **为何分两轴**:防止「正确但不规范」掩盖「规范但做错了」,反之亦然。

### `diagnosing-bugs` —— 有纪律的调试

- **触发词**:"debug this"、"diagnose X"、"this is broken / throwing / failing / slow"、"调试这个 bug"、"排查一下"。
- **何时用**:硬 bug 或性能回归——那种盯着代码看没用的。
- **铁律**:**没有 tight、red-capable 的反馈回路,不准提假设。** Phase 1 才是「这个 skill 的本体」——其余都是机械操作。在你拿不出一条能复现 bug 的、快速、确定、断言用户确切症状的命令前,agent 拒绝理论化。
- **6 个阶段**:建回路并收紧 → 复现并最小化 → 提假设(3–5 条排序、可证伪)→ 插桩(一次只动一个变量,日志打 `[DEBUG-xxxx]` 标签)→ 修 + 在正确的 seam 上写回归测试 → 清理 + 复盘。
- **人肉回路兜底**:当必须人来点击时,用自带的 `skills/diagnosing-bugs/scripts/hitl-loop.template.sh` 把回路结构化。

## 推荐工作流

### 完整闭环 —— 从想法到合并

这五个是设计成咬合的:

1. **`/grill-with-docs`** —— 盘问需求,写 `CONTEXT.md` + ADR
2. **`tdd`** —— 读 `CONTEXT.md` 让测试名对齐领域语言;红 → 绿,一次一个纵切
3. **`code-review`** —— `review since <branch-point>`,拿两份并行报告
4. **重构** —— 在这一步处理 Standards 那轴的问题;`tdd` 故意把重构推迟到这一阶段

### 出 bug 时

`diagnosing-bugs` 跑一个 6 阶段循环,但整个 skill 收敛成一条铁律:**没有 tight、red-capable 的反馈回路,不准提假设。**

1. **建回路并收紧** —— 失败测试 / curl / replay / harness / …
2. **复现并最小化** —— 缩到还能复现的最小场景
3. **提假设** —— 3–5 条排序,每条都要可证伪;先给用户过目
4. **插桩** —— 一次只动一个变量;日志打 `[DEBUG-xxxx]` 标签
5. **修 + 回归测试** —— 在正确的 seam 上;没 seam → 那本身就是发现
6. **清理 + 复盘** —— 删掉插桩;在 commit 里写明真因

### 单 skill 片段

- 只盘问不落盘 → "grill me"(触发 `grilling`,不写任何东西)
- 只固定一个词 → "pin down X"(触发 `domain-modeling`)
- 只测一个功能 → "do X with TDD"
- 只评审一次改动 → "review since main"
- 出 bug 了 → "debug this" / "diagnose X"(触发 `diagnosing-bugs`)

## 实操要点

- **`CONTEXT.md` 是枢纽。** `domain-modeling` 写它;`tdd` 读它,让测试名和接口名跟着项目的领域语言走。建一次词汇表,后面每个测试都受益。
- **`tdd` ↔ `code-review` 是闭环。** `tdd` 明确把重构推迟到评审阶段并指向 `code-review`。只用一个,循环就只闭合了一半。
- **`code-review` 真的会起子 agent。** 你会看到两个 `general-purpose` 子任务并发跑、上下文彼此隔离。这种隔离正是要点——别把它们合并。
- **`code-review` 要一个固定点。** 给它 `review since main`、`review since HEAD~5`、`review since <tag>` 等。不给的话它会问你要。
- **`diagnosing-bugs` 强制顺序。** 在 tight、red-capable 的反馈回路建立前,它拒绝理论化——如果你觉得它「不肯直接猜」很慢,那正是纪律在起作用。遇到必须人肉点击的 bug,它会回落到自带的 `skills/diagnosing-bugs/scripts/hitl-loop.template.sh`。
- **交叉引用都能解析。** `tdd` 指向 `code-review`;`grill-with-docs` 加载 `grilling` + `domain-modeling`;`tdd`、`domain-modeling`、`diagnosing-bugs` 都读 `CONTEXT.md`。所有目标在本仓库都存在。

## 来源与适配

从 [`mattpocock/skills`](https://github.com/mattpocock/skills)(MIT)移植。源仓库面向 Claude Code;为 pi 做了以下适配:

- **user-invoked skill → prompt。** mattpocock 的 `disable-model-invocation` user-invoked skill 映射到 pi 的 `prompts/`(手动触发)。model-invoked skill 映射到 `skills/`(按 description 自动加载)。只有 `grill-with-docs` 变成了 prompt;其余都是 skill。
- **`/skill-name` 交叉调用 → 显式加载。** pi 的 skill 不是斜杠命令,所以 `grill-with-docs` 点名两个 skill 并让 agent 去读它们的 `SKILL.md`。
- **`code-review` 的子 agent 机制。** 原文「两个 `Agent` 工具调用」改成一次 `subagent` 调用、`tasks` 数组里放两项(`agent_type: "general-purpose"`),并发执行且上下文隔离。
- **去掉 Matt 专属接线。** `code-review` 里的 `/setup-matt-pocock-skills` 和 `docs/agents/issue-tracker.md` 引用已移除;抓 issue 改用 `gh issue view <num>`,并把 `AGENTS.md` 加进了 standards 来源。
- **reference 文件移进 `references/`。** mattpocock 把它们当同级文件放;本仓库的约定是 `references/` 子目录。链接相应更新。文件名沿用上游(`tests.md`、`mocking.md`、`CONTEXT-FORMAT.md`、`ADR-FORMAT.md`),因为仓库本来就已混用大小写。
- **`diagnosing-bugs` 的脚本路径和一处被去掉的 skill 引用。** 两处 `hitl-loop.template.sh` 引用都改成完整仓库路径(`skills/diagnosing-bugs/scripts/...`),因为 pi 从 cwd 解析文件路径,而不是从 skill 目录。Phase 6 的 `/improve-codebase-architecture` 移交改成了通用的「专门的架构改进 pass」——那个 skill 没移植(和 `code-philosophy` + `design-an-interface` 重叠)。
- **`writing-great-skills/GLOSSARY.md` 是蒸馏而非作为 skill 移植。** 它的词汇(leading words、两种 invocation 负载、completion criteria、五种 failure mode)放在 `skills/write-a-skill/references/SKILL_VOCABULARY.md`,合并进已有的 `write-a-skill` skill 以避免重叠。
