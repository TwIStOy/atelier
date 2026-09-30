# Extension Config UI — 设计文档

## 1. 概述

本扩展为 `hawtian-pi-extensions` 提供一个统一的扩展配置管理界面。用户可以通过 `/config` 命令打开一个全屏 overlay 弹窗，在终端内直接浏览和修改所有已注册扩展的配置项。

灵感来源：[vstack pi-extension-manager](https://github.com/vanillagreencom/vstack/tree/main/pi-extensions/pi-extension-manager) 的 Quick Settings UI。我们复用其核心交互模式（tab 分组 + 搜索 + 内联编辑 + 键盘导航），但完全基于本项目的 `packages/common` config 基础设施构建。

---

## 2. 动机与目标

**为什么要做这个？**

- 当前 `packages/common` 已提供了 `registerConfigItems` / `getConfigItems` / `readConfig` / `writeConfig` 的完整基础设施，但没有任何 UI 层来消费它。用户修改配置只能手动编辑 JSON 文件。
- 随着扩展数量增加（已有 15+ 个包），需要一个集中的、用户友好的配置入口。

**目标：**

1. 提供一个 `/config` 命令，打开 TUI overlay 弹窗
2. 自动聚合所有通过 `registerConfigItems` 注册的配置项
3. 支持 tab 按扩展分组、模糊搜索、键盘导航
4. 支持内联编辑（文本/数字/布尔/下拉选择/颜色）
5. 修改即持久化到 `~/.config/pi/extensions.json`，无需 reload

---

## 3. UI 布局设计

### 3.1 整体结构

弹窗使用 `ctx.ui.custom()` + `overlay: true` 渲染，居中显示，宽 92%，最高 85%。

```
┏━ Extension Settings ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                                                                     ┃
┃  [All]  statusline  tool-display  inference-self-host  goal  …     ┃
┃                                                                     ┃
┃  > search…█                                                        ┃
┃                                                                     ┃
┃  ─────────────────────────────────────────────────────────────────  ┃
┃                                                                     ┃
┃  statusline                                                         ┃
┃    Show Token Count              true                               ┃
┃      Whether to display token usage in the status bar               ┃
┃    Show Git Branch              true                               ┃
┃      Display current git branch name                                ┃
┃    Separator Character          │                                  ┃
┃                                                                     ┃
┃  tool-display                                                       ┃
┃    Default Expand               collapsed                          ┃
┃      Default expansion state for tool output                        ┃
┃    Max Output Lines             200                                ┃
┃                                                                     ┃
┃  ─────────────────────────────────────────────────────────────────  ┃
┃  tab switch tabs · ↑↓ navigate · enter edit · backspace clear       ┃
┃                                                                     ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

### 3.2 各区域详解

#### 3.2.1 外框 (Frame)

使用 Unicode box-drawing 字符 (`┏━┓┃┗━┛`) 绘制，标题 "Extension Settings" 渲染在顶部边框中，使用 `theme.fg("borderAccent", ...)` 着色。

**设计考量：** vstack 使用手写的 `frame()` 函数。我们直接复用该方案——手写 frame 比用 `DynamicBorder` 更灵活，因为我们需要精确控制内边距、标题嵌入、溢出截断。`DynamicBorder` 更适合简单场景（如 SelectList 对话框），而我们的弹窗需要 tab bar、搜索栏、列表、footer 等多区域组合。

内边距：上下各 1 行，左右各 2 列（与 vstack 一致，视觉呼吸感好）。

#### 3.2.2 Tab 栏 (Tab Bar)

```
 [All]  statusline  tool-display  inference-self-host  goal  …
```

- 激活的 tab 使用 `theme.inverse(theme.bold(label))` 渲染为反色粗体 pill
- 非激活 tab 使用 `theme.bg("selectedBg", theme.fg("accent", label))` 渲染
- Tab 数量超出宽度时，从激活 tab 向两侧交替扩展，溢出时显示 `‹`/`›` 指示器
- `Tab` 键切换下一个 tab，`Shift+Tab` 切换上一个

**设计考量：** vstack 的 tab bar 实现非常成熟（`renderTabBar()` 函数，交替扩展算法）。我们直接移植这个函数，适配我们的 tab 数据源。这是 vstack UI 中最有辨识度的视觉元素之一。

Tab 来源：每个注册了 `ConfigItem` 的 `extensionId` 自动成为一个 tab。"All" tab 始终排在首位。

#### 3.2.3 搜索栏 (Search Bar)

```
 > search query█
```

- 使用 `theme.bg("toolPendingBg", ...)` 着色，模拟输入框
- 光标位置用 `theme.inverse(" ")` 渲染为反色块
- 支持增量搜索：每输入一个字符立即过滤列表
- `Ctrl+U` 清空搜索

**设计考量：** 搜索是高频操作。vstack 的搜索设计简洁高效——不需要专门的搜索模式切换，直接输入就过滤，`Backspace` 删除字符。这个模式在终端 UI 中是标准做法（类似 fzf），用户无需学习成本。

#### 3.2.4 设置列表 (Settings List)

列表项按扩展分组，每个扩展名作为小标题：

```
  statusline                                    ← 扩展名，theme.bold + theme.fg("accent")
    Show Token Count              true          ← 配置项行
      Whether to display token…                ← 描述（仅选中时显示）
    Show Git Branch              true
    Separator Character          │
```

**配置项行的渲染规则：**

| 元素 | 样式 |
|------|------|
| 配置项标签 (Label) | 选中时 `theme.fg("text")`，未选中时默认色 |
| 值 (Value) — 正在编辑 | `theme.fg("accent")` + 块光标 `█` |
| 值 (Value) — 用户显式设置过 | `theme.fg("success")` (绿色) |
| 值 (Value) — 使用默认值 | `theme.fg("muted")` |
| 描述 (Description) | 仅选中行下方显示，`theme.fg("muted")`，4 空格缩进，自动换行 |

**值的格式化规则：**

| ConfigItem 类型 | 显示方式 |
|----------------|---------|
| `boolean` | `true` / `false` |
| `string` | 原始字符串，长文本截断加 `…` |
| `number` | 数字字符串 |
| `select` | 当前选中项的 `label` |
| `color` | 带颜色的色块 `██` + hex 值 |

**设计考量：** vstack 用三种颜色区分"显式设置"vs"使用默认值"——这是一个精妙的设计。用户一眼就能看出哪些配置被改过，哪些还是默认。我们复用这个设计。

分组显示（每个扩展名下缩进显示其配置项）比扁平列表更易浏览。当用户选择 "All" tab 时，能看到所有扩展的配置全貌。

#### 3.2.5 Footer 提示行

```
 tab switch tabs · ↑↓ navigate · enter edit · backspace clear
```

根据当前状态动态变化：

| 状态 | Footer 内容 |
|------|-------------|
| 浏览 | `tab switch · ↑↓ navigate · enter edit/toggle · delete reset · backspace search` |
| 编辑文本 | `←/→ move · alt+←/→ word · backspace/delete · enter save · esc cancel` |
| 编辑颜色 | （未来：颜色选择器提示） |

**设计考量：** 上下文相关的 footer 提示是 vstack 的核心 UX 特征。用户不需要记忆快捷键，footer 始终展示当前可用操作。我们将复用这个模式。

---

## 4. 交互设计

### 4.1 键盘映射

| 按键 | 上下文 | 动作 |
|------|--------|------|
| `↑` / `↓` | 浏览 | 移动选中项 |
| `PageUp` / `-` | 浏览 | 上翻一页 |
| `PageDown` / `=` | 浏览 | 下翻一页 |
| `Enter` | 浏览 | 开始编辑（文本/数字/颜色）/ 切换（布尔）/ 循环（下拉选择） |
| `Delete` | 浏览 | 重置为默认值 |
| `Tab` | 浏览 | 切换到下一个 tab |
| `Shift+Tab` | 浏览 | 切换到上一个 tab |
| `Backspace` | 浏览 | 删除搜索字符 / 清空搜索 |
| `Ctrl+U` | 浏览 | 清空搜索 |
| `Esc` / `Ctrl+C` | 浏览 | 关闭弹窗 |
| `Alt+X` / `Ctrl+X` | 浏览 | 重置当前扩展的所有配置为默认值 |
| 可打印字符 | 浏览 | 追加到搜索框 |
| `←` / `→` | 编辑 | 移动光标 |
| `Alt+←` / `Alt+→` | 编辑 | 按单词移动光标 |
| `Home` / `Ctrl+A` | 编辑 | 跳到开头 |
| `End` / `Ctrl+E` | 编辑 | 跳到末尾 |
| `Backspace` | 编辑 | 删除光标前字符 |
| `Delete` / `Ctrl+D` | 编辑 | 删除光标后字符 |
| `Ctrl+U` | 编辑 | 清空编辑缓冲区 |
| `Enter` | 编辑 | 保存编辑 |
| `Esc` | 编辑 | 取消编辑 |

**设计考量：** 键盘映射直接继承 vstack 的设计。这是一套经过实践验证的终端 UI 交互模式——单键操作（无模式切换）、增量搜索、Emacs 风格的编辑快捷键。这套方案对终端用户来说很自然。

### 4.2 内联编辑状态机

```
          ┌─────────┐  Enter (boolean/select)
          │ BROWSE  │──────────────────────────┐
          │         │  Enter (string/number/   │
          │         │   color)                 │
          └────┬────┘                          │
               │                               ▼
               │                      ┌────────────────┐
               │  Enter               │  INLINE_EDIT   │
               │  (on bool/select)    │  (buffer+cursor)│
               │                      └───────┬────────┘
               │                              │
               │  ← value toggled/cycled      │ Enter → save
               │  ← back to BROWSE            │ Esc → cancel
               ▼                              ▼
          ┌─────────┐                  (back to BROWSE)
          │ BROWSE  │
          └─────────┘
```

**布尔/下拉选择**：直接在原位切换，不进入编辑模式。布尔值 `true↔false`，下拉选择循环到下一个 option。

**文本/数字/颜色**：进入内联编辑模式，在值的位置显示一个带块光标 `█` 的编辑缓冲区。

### 4.3 搜索过滤

The settings search and select/multiselect option filters use Pi's `fuzzyFilter`: matching is case-insensitive, query characters may be nonconsecutive, and space- or slash-separated tokens must all match in any order. Settings and ordinary options rank by match quality. Reorderable options keep their configured selected-first order while applying the same fuzzy matching. An empty query restores the unfiltered order.

搜索范围（大小写不敏感）：
- 扩展 ID / 显示名
- 配置项 `key`、`label`、`description`、`type`
- 当前值的格式化字符串

过滤后自动调整选中索引和滚动位置，确保选中项始终可见。

---

## 5. 数据流

### 5.1 整体数据流

```
registerConfigItems() (各扩展加载时)
        │
        ▼
   Global Registry (Map<extensionId, ConfigItem[]>)
        │
        ├───── getConfigItems() ──────┐
        │                             │
        ▼                             ▼
  Tab Bar 构建                Setting Row 构建
  (每个 extensionId 一个 tab)  (每个 ConfigItem 一行)
        │                             │
        └──────────┬──────────────────┘
                   │
                   ▼  +  readConfig() 读取当前值
              UI 渲染
                   │
                   ▼  用户修改
              updateConfig() 写入 extensions.json
                   │
                   ▼
              通知相关扩展（事件或回调）
```

### 5.2 配置值的解析层级

```
extensions.json 中的值 (用户显式设置)
        │
        ▼  不存在时回退
   ConfigItem.defaultValue
        │
        ▼  不存在时
   类型默认值 ("" / 0 / false / "")
```

`readConfig()` 已经实现了第一层回退（`{ ...schema.defaults, ...section }`）。我们的 UI 需要额外判断某个值是否被用户显式设置过（用于决定值的颜色），这可以通过对比 `extensions.json` 中的值和 `defaultValue` 来判断。

### 5.3 与 vstack 的关键差异

| 方面 | vstack | 我们的设计 |
|------|--------|-----------|
| 配置 schema 来源 | `package.json` 的 `vstack.extensionManager.settings` | `registerConfigItems()` 运行时注册 |
| 配置存储 | `settings.json` 按层级 | `~/.config/pi/extensions.json` 按 extensionId |
| 扩展发现 | 文件系统扫描 + settings.json packages[] | `getConfigItems()` 从全局注册表获取 |
| UI 入口 | 两个命令 (`/extensions` + `/extensions:settings`) | 一个命令 (`/config`) 专注配置 |
| 版本管理 | 有 (npm update check) | 无 (只管配置，不管安装/更新) |

**设计考量：** 我们的 scope 更聚焦——只做配置管理，不做扩展的安装/卸载/更新。这让 UI 更简单，代码量更少。vstack 的 inventory 系统非常复杂（处理 npm/git/local 包源），我们完全不需要它。

---

## 6. 模块结构

```
packages/extension-config-ui/
├── index.ts                  # 入口：注册 /config 命令
├── types.ts                  # 类型定义
├── config-registry.ts        # 从 global registry 读取并扁平化为 UI 行
├── render/
│   ├── frame.ts              # 外框渲染
│   ├── tab-bar.ts            # Tab 栏渲染
│   ├── search-bar.ts         # 搜索栏渲染
│   ├── setting-list.ts       # 设置列表渲染
│   ├── inline-edit.ts        # 内联编辑渲染 + 输入处理
│   ├── footer.ts             # Footer 提示行渲染
│   └── glyphs.ts             # Unicode/ASCII 图形字符集
├── popup.ts                  # 主弹窗组件 (组装所有 render 模块)
└── package.json
```

**模块职责：**

| 模块 | 职责 |
|------|------|
| `index.ts` | 入口，注册 `/config` 命令，guard symbol 防重复加载 |
| `types.ts` | 所有 TypeScript 类型 |
| `config-registry.ts` | 聚合 `getConfigItems()` + `readConfig()` 为 `SettingRow[]` |
| `render/frame.ts` | `frame()` 函数：box-drawing 外框，标题嵌入，溢出截断 |
| `render/tab-bar.ts` | `renderTabBar()` 函数：pill 样式 tab，交替扩展算法 |
| `render/search-bar.ts` | 搜索栏渲染，光标块 |
| `render/setting-list.ts` | 设置行渲染：标签 + 值 + 描述，选中高亮 |
| `render/inline-edit.ts` | 内联编辑状态机：buffer + cursor，字符级光标移动，word jump |
| `render/footer.ts` | 上下文相关 footer 提示 |
| `render/glyphs.ts` | 两套 glyph (unicode/ascii)，frame 字符、项目符号等 |
| `popup.ts` | 主组件：`ctx.ui.custom()` 的 factory，组装 render，处理输入 |

### 6.1 与 `packages/common` 的关系

- **消费** `getConfigItems()`, `readConfig()`, `updateConfig()`, `registerConfigItems()` — 这些是核心数据源
- **消费** `ConfigItem`, `ConfigItemRegistry` 等类型
- **不修改** `packages/common` — 所有 UI 逻辑在本包内

### 6.2 与 `packages/statusline` / `packages/context-usage` 的对比

| | statusline | context-usage | **extension-config-ui** |
|---|---|---|---|
| UI 形式 | Custom footer | Below-editor widget | **Overlay popup** |
| 生命周期 | session 级持久 | 命令触发，Esc 关闭 | **命令触发，Esc 关闭** |
| 输入处理 | 无 | 仅 Esc | **完整键盘交互** |
| 状态管理 | 无 | WeakMap per ctx | **组件内 UI state** |

---

## 7. 核心类型定义

```typescript
// types.ts

export interface SettingRow {
  extensionId: string;
  extensionLabel: string;
  item: ConfigItem;
  currentValue: unknown;
  isExplicit: boolean;
}

export interface UiState {
  tab: string;          // "all" | extensionId
  search: string;
  selected: number;
  scroll: number;
  editing?: InlineEditState;
}

export interface InlineEditState {
  buffer: string;
  cursor: number;
  rowId: string;
}

export interface TabDef {
  id: string;
  label: string;
}

export interface PopupLayout {
  innerRows: number;
  listRows: number;
}
```

---

## 8. 关键实现细节

### 8.1 从 ConfigItem 到 SettingRow

```typescript
// config-registry.ts

export function buildSettingRows(): SettingRow[] {
  const registries = getConfigItems();
  const rows: SettingRow[] = [];
  for (const { extensionId, items } of registries) {
    const config = readConfig(extensionId, { defaults: Object.fromEntries(
      items.map(i => [i.key, i.defaultValue])
    )});
    for (const item of items) {
      const rawValue = config[item.key as keyof typeof config];
      rows.push({
        extensionId,
        extensionLabel: extensionId,  // 未来可从 package.json 读取 displayName
        item,
        currentValue: rawValue,
        isExplicit: rawValue !== item.defaultValue,
      });
    }
  }
  return rows.sort((a, b) => {
    const ext = a.extensionId.localeCompare(b.extensionId);
    return ext !== 0 ? ext : (a.item.order ?? 0) - (b.item.order ?? 0);
  });
}
```

**设计考量：** vstack 的数据源是文件系统扫描 + package.json 解析，过程很重。我们的数据源是内存中的 `getConfigItems()` + 一次 JSON 文件读取，非常轻量。每次打开弹窗都重新构建数据，保证数据新鲜度。

### 8.2 isExplicit 判断

vstack 通过对比 project settings → user settings → default 的层级来判断。我们的 `extensions.json` 是扁平结构，所以判断更简单：

```typescript
function isExplicit(item: ConfigItem, rawConfig: Record<string, unknown>): boolean {
  return item.key in rawConfig;
}
```

如果 `extensions.json` 中对应 extensionId 的 section 包含该 key，说明用户显式设置过。`readConfig` 返回的是合并后的值（含 default），我们需要原始 JSON 来判断。

**实现方案：** 新增一个 `readRawConfig(extensionId)` 函数到 `packages/common`，只返回 `extensions.json` 中该 section 的原始值（不含 default 合并），或者在本包内直接读取 JSON 文件。

### 8.3 值的保存

```typescript
function saveSetting(row: SettingRow, newValue: unknown): void {
  updateConfig(row.extensionId, { defaults: ... }, { [row.item.key]: newValue });
}
```

直接调用 `updateConfig()`，它是原子写入（tmp file + rename）。保存后无需 reload——扩展下次读取配置时自动获取新值。

### 8.4 滚动同步

与 vstack 相同的滚动同步算法：

```
if selected < scroll → scroll = selected
if selected >= scroll + listRows → scroll = selected - listRows + 1
clamp scroll to [0, max(0, itemCount - listRows)]
```

### 8.5 内联编辑

直接移植 vstack 的 `inline-edit.ts`，它已经处理了：
- UTF-16 感知的光标定位（正确处理多字节字符）
- 字符/单词级光标移动（word boundary 分类：space/word/punct）
- 插入、删除、清空
- 块光标 `█` 渲染

需要适配的部分：
- `parseSettingInput()` 需要映射到我们的 `ConfigItemType`
- 颜色类型需要特殊处理（见 8.6）

### 8.6 颜色类型的编辑（未来增强）

`ColorConfigItem` 是 `packages/common` 特有的类型，vstack 没有。对于 v1 版本，颜色值作为普通字符串编辑（输入 hex 值如 `#ff6600`）。未来可以增加颜色预览块和简单的颜色选择器。

---

## 9. 入口命令

```typescript
// index.ts

export default function (pi: ExtensionAPI) {
  const INSTALLED = Symbol.for("htwang-contrib.extension-config-ui.installed");
  if ((globalThis as any)[INSTALLED]) return;
  (globalThis as any)[INSTALLED] = true;

  pi.registerCommand("config", {
    description: "Browse and edit extension configurations",
    handler: async (_args, ctx) => {
      await openConfigPopup(pi, ctx);
    },
  });
}
```

**设计考量：** 单一入口 `/config`。不需要像 vstack 那样拆分 `/extensions` 和 `/extensions:settings`，因为我们只做配置管理，不做扩展生命周期管理。guard symbol 防止扩展被加载多次（项目已有约定，参考 `context-usage`）。

---

## 10. 视觉效果总结

### 10.1 弹窗外观

```
┏━ Extension Settings ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                                                                ┃
┃  [All]  statusline  tool-display  inference-self-host          ┃
┃                                                                ┃
┃  > █                                                           ┃
┃                                                                ┃
┃  ────────────────────────────────────────────────────────────  ┃
┃                                                                ┃
┃  statusline                                                    ┃
┃    Show Token Count                         true               ┃
┃    Show Git Branch                         true               ┃
┃    Separator                                │                  ┃
┃                                                                ┃
┃  tool-display                                                  ┃
┃    Default Expand                       collapsed              ┃
┃    Max Output Lines                        200                 ┃
┃                                                                ┃
┃                                                                ┃
┃  ────────────────────────────────────────────────────────────  ┃
┃  tab switch · ↑↓ navigate · enter edit · delete reset          ┃
┃                                                                ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

### 10.2 编辑状态

用户选中 "Separator" 按下 Enter：

```
┏━ Extension Settings ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                                                                ┃
┃  [All]  statusline  tool-display  inference-self-host          ┃
┃                                                                ┃
┃   Editing inline value                                         ┃
┃                                                                ┃
┃  ────────────────────────────────────────────────────────────  ┃
┃                                                                ┃
┃  statusline                                                    ┃
┃    Show Token Count                         true               ┃
┃    Show Git Branch                         true               ┃
┃    Separator                               │█                  ┃
┃      Character used as separator in the status bar             ┃
┃                                                                ┃
┃  ────────────────────────────────────────────────────────────  ┃
┃  ←/→ move · alt+←/→ word · backspace/delete · enter save      ┃
┃                                                                ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

### 10.3 颜色方案

| 元素 | 前景色 | 背景色 |
|------|--------|--------|
| 外框边框 | `borderAccent` | — |
| 标题文字 | `borderAccent` (嵌入边框) | — |
| Tab (激活) | `text` (inverse+bold) | `text` (inverse) |
| Tab (非激活) | `accent` | `selectedBg` |
| 搜索栏 | — | `toolPendingBg` |
| 搜索光标 | inverse | — |
| 扩展名标题 | `accent` + bold | — |
| 配置项标签 | `text` (选中) / 默认 | `selectedBg` (选中) |
| 值 (编辑中) | `accent` | — |
| 值 (显式设置) | `success` | — |
| 值 (默认) | `muted` | — |
| 描述 | `muted` | — |
| 分割线 | `dim` | — |
| Footer 提示 | `dim` (文字) + `warning` (快捷键) | — |
| 滚动指示 | `dim` | — |

---

## 11. 依赖关系

```
packages/extension-config-ui/
  depends on:
    @htwang-contrib/common        → getConfigItems, readConfig, updateConfig, ConfigItem types
    @earendil-works/pi-coding-agent  → ExtensionAPI, Theme, DynamicBorder
    @earendil-works/pi-tui          → matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi
```

**不引入新的外部依赖。** 所有渲染逻辑基于 ANSI 转义码 + pi theme 系统，与项目现有模式一致。

---

## 12. 实现计划

### Phase 1: 核心弹窗 (MVP)

1. 创建 `packages/extension-config-ui/` 基础结构
2. 实现 `types.ts` + `config-registry.ts`
3. 实现 `render/frame.ts` + `render/glyphs.ts` (移植 vstack)
4. 实现 `render/tab-bar.ts` (移植 vstack `renderTabBar`)
5. 实现 `render/setting-list.ts` (设置列表渲染)
6. 实现 `render/search-bar.ts` + `render/footer.ts`
7. 实现 `popup.ts` (主组件，输入处理)
8. 实现 `index.ts` (入口)

MVP 支持的功能：
- `/config` 命令打开弹窗
- Tab 切换扩展
- 搜索过滤
- 布尔值切换
- 下拉选择循环
- 字符串/数字内联编辑
- `Delete` 重置为默认值

### Phase 2: 增强

- 颜色配置的内联编辑 + 预览
- 扩展的 `displayName` 从 package.json 读取
- `isExplicit` 精确判断（读取原始 JSON）

### Phase 3: 集成

- 为现有扩展添加 `registerConfigItems()` 调用
- statusline: Show Token Count, Show Git Branch, Separator
- tool-display: Default Expand, Max Output Lines
- 其他有配置需求的扩展

---

## 13. 不做的事情

以下功能 vstack 有但我们**不做**（避免 scope creep）：

1. **扩展安装/卸载/更新** — 不做包管理，只做配置
2. **文件系统扫描** — 不扫描 extensions/ 目录，只读 `getConfigItems()`
3. **版本检查** — 不检查 npm registry
4. **诊断面板** — 不做 Alt+A 诊断视图
5. **Split pane (master-detail)** — 不做左右分栏 inspector。配置项的描述直接在选中行下方展示足够
6. **Settings schema in package.json** — 不从 package.json 读取配置声明，用运行时注册
7. **APPEND_SYSTEM.md 管理** — 不涉及

---

## 14. 测试策略

- `config-registry.test.ts`: 测试 SettingRow 构建逻辑（过滤、排序）
- `inline-edit.test.ts`: 测试光标移动、插入、删除（移植 vstack 的测试用例）
- `filters.test.ts`: 测试搜索过滤逻辑
- 手动测试：打开弹窗，切换 tab，搜索，编辑各种类型，验证持久化

---

## 15. 与 vstack 代码的复用关系

| 模块 | 策略 |
|------|------|
| `render/frame.ts` | 移植 vstack 的 `frame()` + `pad()` + `wrapLine()`，适配 import |
| `render/tab-bar.ts` | 移植 vstack 的 `renderTabBar()`，适配 tab 数据源 |
| `render/inline-edit.ts` | 移植 vstack 的 `handleInlineEditInput()` + `renderInlineEditValue()` |
| `render/glyphs.ts` | 移植 vstack 的 glyph 集合 |
| `popup.ts` | 新写，借鉴 vstack 的 `createQuickSettingsComponent` 结构 |
| `config-registry.ts` | 新写，基于 `packages/common` config 基础设施 |
| `types.ts` | 新写，简化版本（无 inventory、无 npm cache、无 uninstall plan） |

**移植原则：** 参考行为和算法，不直接复制代码。适配本项目的 ESM + `.ts` import 规范、`packages/common` 类型系统、pi TUI API。
