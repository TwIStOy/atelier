# 工程类 Skills 使用指南

一组从 [`mattpocock/skills`](https://github.com/mattpocock/skills)(MIT)移植、并适配到本仓库 pi 约定的工作流 skill 和 prompt。它们针对编码 agent 的四种失败模式:没做你想要的、太啰嗦、产出坏代码、把代码搞成泥球。

> 本文件按用户要求用中文撰写,是仓库全局「文档须英文」规则的一个**作用域例外,仅限本文件**。其余文档仍遵循英文规则。

本文是操作手册——每个 skill 干什么、怎么触发、彼此如何咬合。运行时 agent 加载的是各 skill 自己的 `SKILL.md`(那才是事实来源);本文是面向人的索引。

## 两种触发方式

| 类型 | 如何触发 | 成员 |
|---|---|---|
| **Skill**(model-invoked) | 正常说话——agent 把你的请求和每个 skill 的 `description` 做语义匹配,自动加载。不需要斜杠命令。 | `grilling`、`domain-modeling`、`tdd`、`code-review`、`codebase-design`、`diagnosing-bugs`、`research`、`write-a-skill` |
| **Prompt**(user-invoked) | 显式打 `/command`。只能手动触发。 | `/setup-agent-repo-context`、`/grill-with-docs`、`/triage`、`/improve-codebase-architecture`、`/to-spec`、`/to-tickets`、`/implement`、`/wizard`、`/wait-what` |

触发是**语义匹配**,所以中文英文都行——但英文关键词最稳。拿不准就直接点名:"用 tdd skill 来做"。

## 这些 skill

### `grilling` —— 动手前盘问方案

- **触发词**:"stress-test this plan"、"grill me"、"challenge this design"、"interrogate this idea"、"盘问一下这个方案",或任何含 "grill" 的说法。
- **何时用**:想法还模糊,想在碰代码前被交叉盘问到清晰。
- **纪律**:把方案当一棵**决策树**,按**轮(round)**推进——每轮把 frontier 上(前置已敲定、现在就能问的)问题一次性全部问出,每题编号并附推荐答案,等你回答后再算下一轮。**事实自己查**(read/grep/glob 或子 agent),不问你查得到的东西;**决策归你**,逐条等你拍板。frontier 清空前不收工;你确认达成共识前不动手执行方案。
- **无状态**:不向磁盘写任何东西。

### `domain-modeling` —— 固定项目的统一语言

- **触发词**:"pin down this term"、"sharpen the domain language"、"record an architectural decision",讨论代码库术语时、写/改 `CONTEXT.md` 或 ADR 时。
- **何时用**:项目词汇 slippery,或你即将做一个值得记录的、难撤销的决策。
- **产物**:`CONTEXT.md`(一份词汇表——鲜明的正典术语配 `_Avoid_` 同义词,不含实现细节)和 `docs/adr/NNNN-slug.md`(1–3 句的决策记录)。
- **纪律**:术语一敲定就当场记下(绝不攒批);只有三个条件**全满足**才提 ADR——难撤销、没上下文会让人困惑、是真有取舍的结果。

### `/setup-agent-repo-context` —— 给仓库装 agent 上下文

- **怎么用**:`/setup-agent-repo-context`(重配时加 `reconfigure`)。
- **何时用**:第一次在某个仓库用 `/triage` / `/to-spec` / `/to-tickets` / `/implement` 之前,跑一次。
- **产物**:
  - `docs/agents/issue-tracker.md` — GitHub / GitLab / local markdown / 自定义
  - `docs/agents/triage-labels.md` — 五个 triage 角色到真实 label 的映射(仅当 `/triage` 可用)
  - `docs/agents/domain.md` — `CONTEXT.md` / ADR 布局
  - 在 `AGENTS.md`(优先)或 `CLAUDE.md` 里写一段 `## Agent skills` 索引
- **纪律**:先 explore 再问;每节一次问题,推荐答案放前;`ask_user_question` 优先。
- **资源**:`prompts-resource/setup-agent-repo-context/{issue-tracker-github,issue-tracker-gitlab,issue-tracker-local,triage-labels,domain}.md`。

### `/grill-with-docs` —— 边盘问边建领域模型

- **怎么用**:打 `/grill-with-docs`。
- **何时用**:同 `grilling`,但带着代码库——你想让盘问同时持久化一份共享词汇。
- **机制**:一个薄 prompt,组合 `grilling` 和 `domain-modeling` 两个 skill,告诉 agent 加载两者的 `SKILL.md` 并一起应用。

### `/triage` —— 把 issue/PR 过 triage 状态机

- **怎么用**:`/triage` 或 `/triage #42` / `/triage show me what needs attention`。
- **何时用**:维护者要把外部 issue 或 PR 分类、核实、必要时盘问,并写成 agent-ready brief。
- **状态机**:每个 issue 一个 category(`bug`/`enhancement`) + 一个 state(`needs-triage`/`needs-info`/`ready-for-agent`/`ready-for-human`/`wontfix`)。
- **产物**:GitHub 评论上的 agent brief(见 `prompts-resource/triage/AGENT-BRIEF.md`);被拒的 enhancement 写入 `.out-of-scope/`(见 `prompts-resource/triage/OUT-OF-SCOPE.md`)。
- **Tracker**:默认 `gh`;无 GitHub 时回落到 `.scratch/<slug>/`。

### `/improve-codebase-architecture` —— 找加深(deepening)机会

- **怎么用**:`/improve-codebase-architecture` 或 `/improve-codebase-architecture Order intake`。
- **何时用**:代码库浅模块多、测试难、AI 不好导航,想系统扫一遍并挑一个做加深。
- **机制**:
  1. 先定 scope(用户给方向,或从 `git log` 热点推断)。
  2. 用 `subagent`/`explore` 扫代码,按 deep-module 词汇(module/interface/depth/seam/adapter/leverage/locality)记摩擦点。
  3. 写一份自包含 HTML 报告到 `$TMPDIR/architecture-review-<ts>.html`(Tailwind + Mermaid CDN),打开给用户挑。
  4. 用户选中后进入 `grilling` + `domain-modeling` 循环;需要备选接口时用 `codebase-design` 的 design-it-twice 模式。
- **资源**:`prompts-resource/improve-codebase-architecture/HTML-REPORT.md`。

### `codebase-design` —— deep module 设计词汇表

- **触发词**:"design/improve this module's interface"、"where should the seam go"、"find deepening opportunities"、"make this more testable",或任何模块设计/重构讨论。
- **何时用**:设计或重构模块时需要一套共享的架构语言;`/improve-codebase-architecture` 和其他 skill 也依赖它。
- **词汇**:module / interface / implementation / depth / seam / adapter / leverage / locality——严格使用,不许漂移成 "component"、"service"、"API"、"boundary"。
- **原则**:deletion test(删掉它,复杂度是消失还是散落到 N 个调用方)、interface is the test surface、one adapter = hypothetical seam(两个 adapter 才是真 seam)。
- **资源**:`references/DEEPENING.md`(按依赖类别安全地加深模块簇:in-process / local-substitutable / remote-but-owned / true external,以及 replace-don't-layer 测试策略);`references/DESIGN-IT-TWICE.md`(并行子 agent 生成 3+ 个截然不同的接口方案再对比)。
- **历史**:上游把 `design-an-interface` 吸收进了这个 skill(design-it-twice 成为其参考文件);本仓库 2026-09 同步时随之删除了 `design-an-interface`。

### `/to-spec` —— 把当前对话收成一份 spec

- **怎么用**:`/to-spec` 或 `/to-spec my-feature`。
- **何时用**:已经讨论清楚,想落一份 PRD/spec,不再面试用户——只合成已知内容。
- **产物**:GitHub issue(标 `ready-for-agent`),或本地 `.scratch/<slug>/spec.md`。
- **纪律**:先画出要测的 seam 并和用户确认;用户故事要长而全;不写会过期的文件路径。

### `/to-tickets` —— 拆成 tracer-bullet 工单

- **怎么用**:`/to-tickets` 或 `/to-tickets #42` / `/to-tickets path/to/spec.md`。
- **何时用**:有一份 plan/spec/对话,要拆成可独立交付、带阻塞边的纵切工单。
- **纪律**:每张票是垂直切片(schema+API+UI+tests),不是水平切一层;先 prefactor 再做功能;宽重构用 expand–contract,不硬塞进 tracer bullet。
- **产物**:GitHub issues(带 `Blocked by` / native deps)或 `.scratch/<slug>/issues/NN-*.md`。

### `/implement` —— 按 spec/票实现

- **怎么用**:`/implement #42` 或 `/implement path/to/ticket.md`。
- **何时用**:有一张 `ready-for-agent` 票或一份 spec,要真正动手写代码。
- **机制**:加载 `tdd`(在约定 seam 上)→ 持续 typecheck/单测 → 结束时 `code-review` → 提交到当前分支。不扩 scope。

### `/wizard` —— 生成人肉步骤向导脚本

- **怎么用**:`/wizard 配置 Stripe 测试密钥` / `/wizard 数据库迁移到新集群`。
- **何时用**:有一段只有人能做的流程(开第三方控制台、配 CI secret、 provisioning、一次性迁移),每次重讲给 AI 很烦。
- **产物**:一个 bash 向导脚本——逐阶段清屏、开 URL、告诉你点哪复制哪、隐藏输入 secret、幂等写 `.env` / `gh secret`,带进度和收尾总结。默认一次性,放 scratch;可重复使用的才提交进仓库。
- **资源**:库与模板在 `prompts-resource/wizard/template.sh`;`STAGES` 标记以上是固定库,不许手改。

### `/wait-what` —— 没看懂,重讲

- **怎么用**:任何时刻打 `/wait-what`。
- **何时用**:agent 上一条消息没看懂——丢了上下文、跳了步骤、或术语飘了。
- **机制**:要求 agent 用简化技术英语(ASD-STE100)重新 pitch,并带上你缺的上下文;术语跟 `CONTEXT.md`(多上下文仓库按 `CONTEXT-MAP.md` 索引)。

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
- **脱敏先行**:展示任何命令、输出或抓包之前先把 secret 打成 `<REDACTED>`;回路用环境变量携带凭据;抓包只引用携带信号的那几行。
- **6 个阶段**:建回路并收紧 → 复现并最小化 → 提假设(3–5 条排序、可证伪)→ 插桩(一次只动一个变量,日志打 `[DEBUG-xxxx]` 标签)→ 修 + 在正确的 seam 上写回归测试 → 清理。
- **人肉回路兜底**:当必须人来点击时,用自带的 `skills/diagnosing-bugs/scripts/hitl-loop.template.sh` 把回路结构化。

### `research` —— 后台子 agent 调研落盘

- **触发词**:"research X"、"look into this topic"、"gather docs/API facts"、"调研一下这个问题"。
- **何时用**:有一个值得查证的问题,阅读量不适合当前会话背;你想继续干活,让调研在后台跑。
- **机制**:用 `subagent` 工具 `background: true` 起一个后台子 agent(立即返回 job id),需要结论时用 `subagent_status` 轮询。
- **纪律**:只认**一手来源**(官方文档、源码、spec、第一方 API),每条结论回溯到拥有它的那个来源;二级转述不算证据。
- **产物**:单个 Markdown 文件,每条结论带引用;存放位置跟随仓库已有惯例,没有惯例就选个合理位置并告知。

## 推荐工作流

### 完整闭环 —— 从想法到合并

这些是设计成咬合的:

0. **`/setup-agent-repo-context`**(每个仓库一次)—— 写 `docs/agents/*`,后面的 prompt 优先读它们
1. **`/grill-with-docs`** —— 盘问需求,写 `CONTEXT.md` + ADR
2. **`/to-spec`** —— 把共识收成一份 spec 并发布(标 `ready-for-agent`)
3. **`/to-tickets`** —— 把 spec 拆成带阻塞边的 tracer-bullet 工单
4. **`/implement`** —— 对 frontier 上的票,加载 `tdd` 做红 → 绿,结束时 `code-review` 并提交
5. **重构** —— 在 `code-review` 的 Standards 轴上处理;`tdd` 故意把重构推迟到这一阶段

外部 issue/PR 入口:

- **`/triage`** —— 分类 → 核实 → 必要时盘问 → agent brief / wontfix / needs-info

架构变烂时:

- **`/improve-codebase-architecture`** —— HTML 报告扫加深机会 → 选中后 grilling + domain-modeling

### 出 bug 时

`diagnosing-bugs` 跑一个 6 阶段循环,但整个 skill 收敛成一条铁律:**没有 tight、red-capable 的反馈回路,不准提假设。**

1. **建回路并收紧** —— 失败测试 / curl / replay / harness / …
2. **复现并最小化** —— 缩到还能复现的最小场景
3. **提假设** —— 3–5 条排序,每条都要可证伪;先给用户过目
4. **插桩** —— 一次只动一个变量;日志打 `[DEBUG-xxxx]` 标签
5. **修 + 回归测试** —— 在正确的 seam 上;没 seam → 那本身就是发现
6. **清理** —— 删掉插桩;在 commit 里写明真因

### 单 skill 片段

- 只盘问不落盘 → "grill me"(触发 `grilling`,不写任何东西)
- 只固定一个词 → "pin down X"(触发 `domain-modeling`)
- 只测一个功能 → "do X with TDD"
- 只评审一次改动 → "review since main"
- 出 bug 了 → "debug this" / "diagnose X"(触发 `diagnosing-bugs`)
- 要调研一个主题、背不动阅读量 → "research X"(触发 `research`,后台子 agent 落盘 Markdown)
- 看不懂 agent 在说什么 → `/wait-what`
- 要人肉走一遍配置/迁移 → `/wizard`

## 实操要点

- **`CONTEXT.md` 是枢纽。** `domain-modeling` 写它;`tdd` 读它,让测试名和接口名跟着项目的领域语言走。建一次词汇表,后面每个测试都受益。
- **`tdd` ↔ `code-review` 是闭环。** `tdd` 明确把重构推迟到评审阶段并指向 `code-review`。只用一个,循环就只闭合了一半。
- **`code-review` 真的会起子 agent。** 你会看到两个 `general-purpose` 子任务并发跑、上下文彼此隔离。这种隔离正是要点——别把它们合并。
- **`code-review` 要一个固定点。** 给它 `review since main`、`review since HEAD~5`、`review since <tag>` 等。不给的话它会问你要。
- **`diagnosing-bugs` 强制顺序。** 在 tight、red-capable 的反馈回路建立前,它拒绝理论化——如果你觉得它「不肯直接猜」很慢,那正是纪律在起作用。遇到必须人肉点击的 bug,它会回落到自带的 `skills/diagnosing-bugs/scripts/hitl-loop.template.sh`。
- **交叉引用都能解析。** `tdd` 指向 `code-review`;`grill-with-docs` / `triage` / `improve-codebase-architecture` 加载 `grilling` + `domain-modeling`;`improve-codebase-architecture` 还加载 `codebase-design`(词汇 + design-it-twice);`implement` 加载 `tdd` + `code-review`;`tdd`、`domain-modeling`、`diagnosing-bugs`、`improve-codebase-architecture` 都读 `CONTEXT.md`。所有目标在本仓库都存在。
- **Prompt 资源路径从仓库根解析。** 例如 `prompts-resource/triage/AGENT-BRIEF.md`、`prompts-resource/improve-codebase-architecture/HTML-REPORT.md`、`prompts-resource/setup-agent-repo-context/`——pi 从 cwd 解析路径,不是从 prompt 文件所在目录。
- **`docs/agents/*` 是 per-repo 配置。** `/triage`、`/to-spec`、`/to-tickets`、`/implement` 优先读它们;缺失时回落到内联的 `gh` / `.scratch` 默认。

## 来源与适配

从 [`mattpocock/skills`](https://github.com/mattpocock/skills)(MIT)移植。源仓库面向 Claude Code;为 pi 做了以下适配:

- **user-invoked skill → prompt。** mattpocock 的 `disable-model-invocation` user-invoked skill 映射到 pi 的 `prompts/`(手动触发)。model-invoked skill 映射到 `skills/`(按 description 自动加载)。变成 prompt 的有:`setup-agent-repo-context`(上游 `setup-matt-pocock-skills`)、`grill-with-docs`、`triage`、`improve-codebase-architecture`、`to-spec`、`to-tickets`、`implement`。
- **`/skill-name` 交叉调用 → 显式加载。** pi 的 skill 不是斜杠命令,所以 prompt 点名 skill 并让 agent 去读它们的 `SKILL.md`(例如 `implement` 加载 `tdd` + `code-review`)。
- **`code-review` 的子 agent 机制。** 原文「两个 `Agent` 工具调用」改成一次 `subagent` 调用、`tasks` 数组里放两项(`agent_type: "general-purpose"`),并发执行且上下文隔离。
- **`setup-matt-pocock-skills` → `/setup-agent-repo-context`。** 改名并去掉所有 Matt 专属字样;产物仍写 `docs/agents/{issue-tracker,triage-labels,domain}.md`。优先编辑 `AGENTS.md`(pi 约定),其次 `CLAUDE.md`。`/triage` / `/to-spec` / `/to-tickets` / `/implement` 优先读这些文件,缺失时回落到内联 `gh` / `.scratch` 默认。
- **`improve-codebase-architecture` 加载 `codebase-design` 获取词汇。** 上游同样让该命令调用 model-invoked 的 `codebase-design` skill;本仓库把 prompt 里原内联的词汇表换成显式加载 `skills/codebase-design/SKILL.md`,避免双份维护。接口备选指向上游吸收了 `design-an-interface` 的 `references/DESIGN-IT-TWICE.md`。
- **`design-an-interface` 已删除(2026-09)。** 上游把它废弃并吸收进 `codebase-design`;本仓库同步删除,原 prompt/文档引用改指 `codebase-design`。
- **`research` 移植为 model-invoked skill(2026-09)。** 上游的 "background agent" 机制适配为 `subagent` 工具的 `background: true` + `subagent_status` 轮询。
- **Prompt 附带资源放在 `prompts-resource/<name>/`。** 例如 `triage` 的 `AGENT-BRIEF.md` / `OUT-OF-SCOPE.md`,`improve-codebase-architecture` 的 `HTML-REPORT.md`。入口 prompt 用仓库根相对路径引用。
- **reference 文件移进 `references/`。** mattpocock 把它们当同级文件放;本仓库 skill 的约定是 `references/` 子目录。链接相应更新。文件名沿用上游(`tests.md`、`mocking.md`、`CONTEXT-FORMAT.md`、`ADR-FORMAT.md`),因为仓库本来就已混用大小写。
- **`diagnosing-bugs` 的脚本路径。** 两处 `hitl-loop.template.sh` 引用都改成完整仓库路径(`skills/diagnosing-bugs/scripts/...`),因为 pi 从 cwd 解析文件路径,而不是从 skill 目录。Phase 6 现在只做清理;上游已把 post-mortem 移交 `/improve-codebase-architecture` 的段落整个删除(model-invoked skill 不能调 user-invoked prompt,且实践中很少触发),本仓库同步。
- **`grilling` 同步到 rounds/frontier 模型(2026-08)。** 上游把「一次一问」重写为按轮推进:每轮把 frontier 上全部可问问题一次性编号问出;新增 facts(decisions 分离(facts 自己查/子 agent,decisions 归用户)和显式 confirm gate。`/grill-with-docs`、`/triage` 中对 grilling 的描述已同步。
- **`writing-great-skills/GLOSSARY.md` 是蒸馏而非作为 skill 移植。** 它的词汇(leading words、两种 invocation 负载、completion criteria、五种 failure mode)放在 `skills/write-a-skill/references/SKILL_VOCABULARY.md`,合并进已有的 `write-a-skill` skill 以避免重叠。上游后来删除了 `writing-great-skills`,由泛化的 `writing-for-agents` 接替;2026-08 同步时按同样方式把其新增概念(context pointer、negation、environment-as-cache)蒸馏进了该词汇表。
- **`/wizard`、`/wait-what`(2026-08 新增)。** 上游均为 user-invoked,按约定映射到 `prompts/`。`wizard` 的 `template.sh` 原样放在 `prompts-resource/wizard/template.sh`(仅头注释改为 "Generated by the /wizard prompt")。
