# Extension Config UI — 执行清单

> 每一步都标注了对应的 [DESIGN.md](./DESIGN.md) 章节，方便追溯设计决策。
> 复选框 `- [ ]` 用于跟踪进度，完成时改为 `- [x]`。

---

## Phase 1: 核心弹窗 (MVP)

### Step 1.1 — 创建包骨架

> ref: [§6 模块结构](./DESIGN.md#6-模块结构) · [§11 依赖关系](./DESIGN.md#11-依赖关系)

- [x] 1.1.1 创建 `packages/extension-config-ui/` 目录
- [x] 1.1.2 创建 `package.json`
- [x] 1.1.3 创建 `tsconfig.json`
- [x] 1.1.4 创建 `render/` 子目录
- [x] 1.1.5 在根 `tsconfig.json` 的 references 数组中添加本包
- [x] 1.1.6 `npx tsc --build` 验证骨架编译通过

---

### Step 1.2 — 类型定义

> ref: [§7 核心类型定义](./DESIGN.md#7-核心类型定义)

- [x] 1.2.1 创建 `types.ts`
- [x] 1.2.2 定义常量
- [x] 1.2.3 从 `@htwang-contrib/common` re-export 类型

---

### Step 1.3 — 配置注册表桥接

> ref: [§8.1](./DESIGN.md#81-从-configitem-到-settingrow) · [§8.2](./DESIGN.md#82-isexplicit-判断) · [§5.1](./DESIGN.md#51-整体数据流)

- [x] 1.3.1 创建 `config-registry.ts`
- [x] 1.3.2 实现 `buildSettingRows()`
- [x] 1.3.3 实现 `isExplicit()` 判断
- [x] 1.3.4 实现 `buildTabs()`
- [x] 1.3.5 实现 `filterRows()`
- [x] 1.3.6 实现 `saveSetting()`
- [x] 1.3.7 实现 `resetSetting()`

---

### Step 1.4 — Glyph 系统

> ref: [§15 glyphs](./DESIGN.md#15-与-vstack-代码的复用关系)

- [x] 1.4.1 创建 `render/glyphs.ts`
- [x] 1.4.2 定义 `GlyphSet` + `GLYPHS`
- [x] 1.4.3 实现 `glyphs()`
- [x] 1.4.4 导出 `frameGlyphs()`

---

### Step 1.5 — Frame 渲染

> ref: [§3.2.1](./DESIGN.md#321-外框-frame)

- [x] 1.5.1 创建 `render/frame.ts`
- [x] 1.5.2 实现 `pad()`
- [x] 1.5.3 实现 `wrapLine()`
- [x] 1.5.4 实现 `divider()`

---

### Step 1.6 — Tab 栏渲染

> ref: [§3.2.2](./DESIGN.md#322-tab-栏-tab-bar)

- [x] 1.6.1 创建 `render/tab-bar.ts`
- [x] 1.6.2 实现 `activePill()` / `inactivePill()`
- [x] 1.6.3 实现 `renderTabBar()` 交替扩展算法

---

### Step 1.7 — 搜索栏渲染

> ref: [§3.2.3](./DESIGN.md#323-搜索栏-search-bar)

- [x] 1.7.1 创建 `render/search-bar.ts`
- [x] 1.7.2 实现 `renderSearchBar()`

---

### Step 1.8 — 设置列表渲染

> ref: [§3.2.4](./DESIGN.md#324-设置列表-settings-list) · [§10.3](./DESIGN.md#103-颜色方案)

- [x] 1.8.1 创建 `render/setting-list.ts`
- [x] 1.8.2 实现 `formatSettingValue()`
- [x] 1.8.3 实现 `valueColor()` 三色区分
- [x] 1.8.4 实现 `renderSettingList()`
- [x] 1.8.5 实现 `renderSelectPage()` (select/multiselect 二级页面)

---

### Step 1.9 — 内联编辑

> ref: [§4.2](./DESIGN.md#42-内联编辑状态机) · [§8.5](./DESIGN.md#85-内联编辑)

- [x] 1.9.1 创建 `render/inline-edit.ts`
- [x] 1.9.2 实现字符索引映射
- [x] 1.9.3 实现字符分类 `charKind()`
- [x] 1.9.4 实现光标移动 (char/word)
- [x] 1.9.5 实现编辑操作 (insert/delete)
- [x] 1.9.6 实现 `handleInlineEditInput()`
- [x] 1.9.7 实现 `renderInlineEditValue()`
- [x] 1.9.8 实现 `parseSettingInput()` (含 color 校验)

---

### Step 1.10 — Footer 渲染

> ref: [§3.2.5](./DESIGN.md#325-footer-提示行)

- [x] 1.10.1 创建 `render/footer.ts`
- [x] 1.10.2 实现 `renderFooter()` — browse/editing/selecting 三态

---

### Step 1.11 — 主弹窗组件

> ref: [§4.1](./DESIGN.md#41-键盘映射) · [§8.4](./DESIGN.md#84-滚动同步) · [§3.1](./DESIGN.md#31-整体结构)

- [x] 1.11.1 创建 `popup.ts`
- [x] 1.11.2 实现 `makeInitialUiState()`
- [x] 1.11.3 实现 `computeLayout()`
- [x] 1.11.4 实现 `syncViewport()`
- [x] 1.11.5 实现 `createConfigComponent()` — 含 select 二级页面、multiselect toggle
- [x] 1.11.6 实现 `editOrToggle()`
- [x] 1.11.7 实现 `saveInlineEdit()` — 仅值变化时写文件
- [x] 1.11.8 实现 `resetCurrentSetting()`
- [x] 1.11.9 实现 `resetCurrentExtension()`

---

### Step 1.12 — 入口命令

> ref: [§9 入口命令](./DESIGN.md#9-入口命令)

- [x] 1.12.1 创建 `index.ts`
- [x] 1.12.2 实现 guard symbol
- [x] 1.12.3 注册 `/config` 命令
- [x] 1.12.4 实现 `openConfigPopup()`
- [x] 1.12.5 无配置项时 notify
- [x] 1.12.6 注册 `/config:demo` 命令（含所有类型 demo）

---

### Step 1.13 — MVP 集成验证

> ref: [§14 测试策略](./DESIGN.md#14-测试策略)

- [x] 1.13.1 `npx tsc --build` 全项目编译通过
- [x] 1.13.2 `npm test` 全部通过
- [x] 1.13.3 手动测试：`/config:demo` 打开弹窗 ✅
- [x] 1.13.4 手动测试：tab 切换（←/→ / Tab） ✅
- [x] 1.13.5 手动测试：搜索过滤 ✅
- [x] 1.13.6 手动测试：布尔切换 ✅
- [x] 1.13.7 手动测试：select 二级页面选择 ✅
- [x] 1.13.8 手动测试：multiselect 二级页面 toggle ✅
- [x] 1.13.9 手动测试：字符串/数字编辑 ✅
- [x] 1.13.10 手动测试：颜色编辑 + 校验 ✅
- [x] 1.13.11 手动测试：编辑未改动不变色 ✅
- [x] 1.13.12 手动测试：Delete 重置 + Alt+X 重置扩展 ✅
- [x] 1.13.13 手动测试：Esc 关闭弹窗 ✅

---

## Phase 2: 增强

### Step 2.1 — isExplicit 精确判断

> ref: [§8.2 isExplicit 判断](./DESIGN.md#82-isexplicit-判断)

- [x] 2.1.1 在 `packages/common` 新增 `readRawConfig()`
- [x] 2.1.2 从 `packages/common` 公共 API 导出
- [x] 2.1.3 `config-registry.ts` 改用 `readRawConfig()`，删除本地 `readRawSection()`
- [x] 2.1.4 手动验证三色区分正确

### Step 2.2 — 颜色配置增强

> ref: [§8.6 颜色类型的编辑](./DESIGN.md#86-颜色类型的编辑未来增强)

- [x] 2.2.1 `formatSettingValue` 中 color 类型用 truecolor `\x1b[38;2;R;G;Bm` 渲染色块
- [x] 2.2.2 `parseSettingInput` 中 color 类型校验 `#RGB` / `#RRGGBB` 格式

### Step 2.3 — 扩展显示名

> ref: [§8.1 extensionLabel](./DESIGN.md#81-从-configitem-到-settingrow)

- [x] 2.3.1 `ConfigItemBase` 新增 `extensionLabel?: string`
- [x] 2.3.2 `buildSettingRows()` 优先使用 `extensionLabel`
- [x] 2.3.3 Demo 中使用 display name（"Feature Flags"、"Editor Features"、"Project Settings"）

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
| 1 | Step 1.13 — MVP 集成验证 | ✅ 完成 |
| 2 | Step 2.1 — isExplicit 精确判断 | ✅ 完成 |
| 2 | Step 2.2 — 颜色配置增强 | ✅ 完成 |
| 2 | Step 2.3 — 扩展显示名 | ✅ 完成 |
| 3 | Step 3.x — 为现有扩展注册配置项 | ⬜ 未开始 |

> 状态图例：⬜ 未开始 · 🔄 进行中 · ✅ 完成
