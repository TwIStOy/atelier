# Extension Config UI — 执行清单

> 每一步都标注了对应的 [DESIGN.md](./DESIGN.md) 章节，方便追溯设计决策。
> 复选框 `- [ ]` 用于跟踪进度，完成时改为 `- [x]`。

---

## Phase 1: 核心弹窗 (MVP)

### Step 1.1 — 创建包骨架

> ref: [§6 模块结构](./DESIGN.md#6-模块结构) · [§11 依赖关系](./DESIGN.md#11-依赖关系)

- [x] 1.1.1 创建 `packages/extension-config-ui/` 目录
- [x] 1.1.2 创建 `package.json`（name: `@htwang-contrib/extension-config-ui`，peerDependencies: `@htwang-contrib/common`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`）
- [x] 1.1.3 创建 `tsconfig.json`（extends root，references `../common`）
- [x] 1.1.4 创建 `render/` 子目录
- [x] 1.1.5 在根 `tsconfig.json` 的 references 数组中添加本包
- [x] 1.1.6 `npx tsc --build` 验证骨架编译通过

**产出物：** 空的包骨架，能够被 TypeScript 项目引用。

---

### Step 1.2 — 类型定义

> ref: [§7 核心类型定义](./DESIGN.md#7-核心类型定义) · [§6 模块结构 — types.ts](./DESIGN.md#6-模块结构)

- [x] 1.2.1 创建 `types.ts`，定义 `SettingRow`, `UiState`, `InlineEditState`, `TabDef`, `PopupLayout`
- [x] 1.2.2 定义常量：`TAB_ALL`, `PACKAGE_TAB_PREFIX`, `POPUP_PADDING_X/Y`, `DEFAULT_WIDTH_PERCENT`, `DEFAULT_MAX_HEIGHT`
- [x] 1.2.3 从 `@htwang-contrib/common` re-export `ConfigItem` 等需要的类型

**产出物：** 所有其他模块共用的类型文件。

**验证：** `npx tsc --build` 通过。

---

### Step 1.3 — 配置注册表桥接

> ref: [§8.1 从 ConfigItem 到 SettingRow](./DESIGN.md#81-从-configitem-到-settingrow) · [§8.2 isExplicit 判断](./DESIGN.md#82-isexplicit-判断) · [§5.1 整体数据流](./DESIGN.md#51-整体数据流)

- [x] 1.3.1 创建 `config-registry.ts`
- [x] 1.3.2 实现 `buildSettingRows(): SettingRow[]` — 调用 `getConfigItems()` + `readConfig()` 聚合数据
- [x] 1.3.3 实现 `isExplicit()` 判断 — 对比 raw JSON 中的 key 是否存在（需要直接读 extensions.json 的原始 section，不能用 readConfig 的合并结果）
- [x] 1.3.4 实现 `buildTabs(rows: SettingRow[]): TabDef[]` — 每个唯一 extensionId 生成一个 tab，"All" 固定首位
- [x] 1.3.5 实现 `filterRows(rows, search, tab): SettingRow[]` — 搜索过滤 + tab 过滤，搜索范围覆盖 §4.3 定义的字段
- [x] 1.3.6 实现 `saveSetting(row, newValue)` — 调用 `updateConfig()`
- [x] 1.3.7 实现 `resetSetting(row)` — 从 extensions.json 中删除该 key

**产出物：** 数据层，将 `packages/common` 的配置基础设施转化为 UI 可消费的扁平结构。

---

### Step 1.4 — Glyph 系统

> ref: [§15 与 vstack 代码的复用关系 — glyphs](./DESIGN.md#15-与-vstack-代码的复用关系) · vstack `glyphs.ts`

- [x] 1.4.1 创建 `render/glyphs.ts`
- [x] 1.4.2 定义 `GlyphSet` 类型 + `GLYPHS` 常量（unicode/ascii 两套）
- [x] 1.4.3 实现 `glyphs(): GlyphSet` — 默认 unicode，硬编码即可
- [x] 1.4.4 导出 `frameGlyphs()` 辅助函数

**产出物：** Unicode/ASCII 双套图形字符。

---

### Step 1.5 — Frame 渲染

> ref: [§3.2.1 外框 Frame](./DESIGN.md#321-外框-frame) · [§15 — frame](./DESIGN.md#15-与-vstack-代码的复用关系) · vstack `render.ts`

- [x] 1.5.1 创建 `render/frame.ts`
- [x] 1.5.2 实现 `frameContentWidth(width): number`
- [x] 1.5.3 实现 `pad(text, width): string` — 截断 + 填充到定宽
- [x] 1.5.4 实现 `wrapLine(line, width): string[]` — ANSI 感知自动换行
- [x] 1.5.5 实现 `divider(width, theme): string` — 分割线
- [x] 1.5.6 实现 `frame(lines, width, theme, fixedInnerRows?, title?): string[]` — box-drawing 外框

**产出物：** 外框渲染函数。

---

### Step 1.6 — Tab 栏渲染

> ref: [§3.2.2 Tab 栏](./DESIGN.md#322-tab-栏-tab-bar) · vstack `render.ts::renderTabBar()`

- [x] 1.6.1 创建 `render/tab-bar.ts`
- [x] 1.6.2 实现 `activePill(theme, label)` — `theme.inverse(theme.bold(label))`
- [x] 1.6.3 实现 `inactivePill(theme, label)` — `theme.bg("selectedBg", theme.fg("accent", label))`
- [x] 1.6.4 实现 `renderTabBar(tabs, activeId, width, theme): string` — 交替扩展算法

**产出物：** Tab 栏渲染函数。

---

### Step 1.7 — 搜索栏渲染

> ref: [§3.2.3 搜索栏 Search Bar](./DESIGN.md#323-搜索栏-search-bar)

- [x] 1.7.1 创建 `render/search-bar.ts`
- [x] 1.7.2 实现 `renderSearchBar(search, width, theme, editing): string`

**产出物：** 搜索栏渲染函数。

---

### Step 1.8 — 设置列表渲染

> ref: [§3.2.4 设置列表 Settings List](./DESIGN.md#324-设置列表-settings-list) · [§10.3 颜色方案](./DESIGN.md#103-颜色方案)

- [x] 1.8.1 创建 `render/setting-list.ts`
- [x] 1.8.2 实现 `formatSettingValue(item, value): string` — 按 ConfigItem 类型格式化
- [x] 1.8.3 实现 `valueColor()` — 根据编辑/显式/默认状态着色
- [x] 1.8.4 实现 `renderSettingList()` — 完整列表渲染（分组、高亮、描述、滚动指示）

**产出物：** 设置列表渲染函数。

---

### Step 1.9 — 内联编辑

> ref: [§4.2 内联编辑状态机](./DESIGN.md#42-内联编辑状态机) · [§8.5 内联编辑](./DESIGN.md#85-内联编辑)

- [x] 1.9.1 创建 `render/inline-edit.ts`
- [x] 1.9.2 实现字符索引映射：`inlineEditChars()`, `codeUnitToCharIndex()`, `charIndexToCodeUnit()`
- [x] 1.9.3 实现字符分类：`charKind(ch)`
- [x] 1.9.4 实现光标移动：`moveByChars()`, `moveWordLeft()`, `moveWordRight()`
- [x] 1.9.5 实现编辑操作：`insertText()`, `deleteRange()`
- [x] 1.9.6 实现 `handleInlineEditInput(editing, data): boolean`
- [x] 1.9.7 实现 `renderInlineEditValue(editing): string`
- [x] 1.9.8 实现 `parseSettingInput(item, input): unknown`

**产出物：** 内联编辑模块。

---

### Step 1.10 — Footer 渲染

> ref: [§3.2.5 Footer 提示行](./DESIGN.md#325-footer-提示行)

- [x] 1.10.1 创建 `render/footer.ts`
- [x] 1.10.2 实现 `renderFooter(theme, editing): string` — 上下文相关提示

**产出物：** 上下文相关 footer。

---

### Step 1.11 — 主弹窗组件

> ref: [§4.1 键盘映射](./DESIGN.md#41-键盘映射) · [§8.4 滚动同步](./DESIGN.md#84-滚动同步) · [§3.1 整体结构](./DESIGN.md#31-整体结构)

- [x] 1.11.1 创建 `popup.ts`
- [x] 1.11.2 实现 `makeInitialUiState(): UiState`
- [x] 1.11.3 实现 `computeLayout(terminalRows): PopupLayout`
- [x] 1.11.4 实现滚动同步 `syncViewport()`
- [x] 1.11.5 实现 `createConfigComponent()` — 完整交互组件
- [x] 1.11.6 实现 `editOrToggle()`
- [x] 1.11.7 实现 `saveInlineEdit()`
- [x] 1.11.8 实现 `resetCurrentSetting()`
- [x] 1.11.9 实现 `resetCurrentExtension()`

**产出物：** 完整的弹窗交互组件。

---

### Step 1.12 — 入口命令

> ref: [§9 入口命令](./DESIGN.md#9-入口命令)

- [x] 1.12.1 创建 `index.ts`
- [x] 1.12.2 实现 guard symbol
- [x] 1.12.3 注册 `/config` 命令
- [x] 1.12.4 实现 `openConfigPopup()`
- [x] 1.12.5 无配置项时 notify

**产出物：** 可通过 `/config` 打开的完整弹窗。

---

### Step 1.13 — MVP 集成验证

> ref: [§14 测试策略](./DESIGN.md#14-测试策略)

- [x] 1.13.1 `npx tsc --build` 全项目编译通过
- [x] 1.13.2 `npm test` 全部通过 (165 passed)
- [ ] 1.13.3 手动测试：`/config:demo` 打开 demo 弹窗
- [ ] 1.13.4 手动测试：tab 切换 + 搜索 + 布尔切换 + 字符串编辑 + Delete 重置 + Esc 关闭

---

## Phase 2: 增强

### Step 2.1 — isExplicit 精确判断

> ref: [§8.2 isExplicit 判断](./DESIGN.md#82-isexplicit-判断)

- [ ] 2.1.1 在 `packages/common` 中新增 `readRawConfig()`
- [ ] 2.1.2 修改 `config-registry.ts` 使用 `readRawConfig()`
- [ ] 2.1.3 验证三色区分正确

### Step 2.2 — 颜色配置增强

> ref: [§8.6 颜色类型的编辑](./DESIGN.md#86-颜色类型的编辑未来增强)

- [ ] 2.2.1 color 类型显示 `██` + hex 值
- [ ] 2.2.2 编辑颜色时作为普通字符串

### Step 2.3 — 扩展显示名

> ref: [§8.1 extensionLabel](./DESIGN.md#81-从-configitem-到-settingrow)

- [ ] 2.3.1 在 `ConfigItemBase` 中增加 `extensionLabel`
- [ ] 2.3.2 Tab 栏和列表标题使用 `extensionLabel`

---

## Phase 3: 为现有扩展注册配置项

> ref: [§5.1 整体数据流](./DESIGN.md#51-整体数据流) · [§2 目标](./DESIGN.md#2-动机与目标)

- [ ] 3.1 `packages/statusline/` — 注册配置项
- [ ] 3.2 `packages/tool-display/` — 注册配置项
- [ ] 3.3 `packages/inference-self-host/` — 注册配置项
- [ ] 3.4 `packages/goal/` — 注册配置项
- [ ] 3.5 `packages/context-usage/` — 注册配置项
- [ ] 3.6 其他有配置需求的扩展

---

## 进度追踪

| Phase | 步骤 | 状态 |
|-------|------|------|
| 1 | Step 1.1 — 包骨架 | ✅ 完成 |
| 1 | Step 1.2 — 类型定义 | ✅ 完成 |
| 1 | Step 1.3 — 配置注册表桥接 | ✅ 完成 |
| 1 | Step 1.4 — Glyph 系统 | ✅ 完成 |
| 1 | Step 1.5 — Frame 渲染 | ✅ 完成 |
| 1 | Step 1.6 — Tab 栏渲染 | ✅ 完成 |
| 1 | Step 1.7 — 搜索栏渲染 | ✅ 完成 |
| 1 | Step 1.8 — 设置列表渲染 | ✅ 完成 |
| 1 | Step 1.9 — 内联编辑 | ✅ 完成 |
| 1 | Step 1.10 — Footer 渲染 | ✅ 完成 |
| 1 | Step 1.11 — 主弹窗组件 | ✅ 完成 |
| 1 | Step 1.12 — 入口命令 | ✅ 完成 |
| 1 | Step 1.13 — MVP 集成验证 | 🔄 编译通过，待手动测试 |
| 2 | Step 2.1 — isExplicit 精确判断 | ⬜ 未开始 |
| 2 | Step 2.2 — 颜色配置增强 | ⬜ 未开始 |
| 2 | Step 2.3 — 扩展显示名 | ⬜ 未开始 |
| 3 | Step 3.x — 为现有扩展注册配置项 | ⬜ 未开始 |

> 状态图例：⬜ 未开始 · 🔄 进行中 · ✅ 完成
