# pi-speeed Spinner 资源提取

> 从 [`somus/pi-speeed`](https://github.com/somus/pi-speeed) `src/runcat.ts` + `src/presets.ts` + `assets/runcat.ttf` 提取。
> 本文件只收录「与 spinner / 图标 / 视觉素材」直接相关的常量，供本仓库复用参考。

## 1. RunCat 帧数组（核心 spinner）

`src/runcat.ts`：

```ts
export const RUNCAT_FRAMES = ["\ue900 ", "\ue901 ", "\ue902 ", "\ue903 ", "\ue904 "];
```

| 帧索引 | 字符（转义） | Unicode 码位 | 字体 glyph | 后缀 |
| ------ | ------------ | ------------ | ---------- | ---- |
| 0 | `\ue900 ` | `U+E900` | glyph 4 | 半角空格 `U+0020` |
| 1 | `\ue901 ` | `U+E901` | glyph 5 | 半角空格 |
| 2 | `\ue902 ` | `U+E902` | glyph 6 | 半角空格 |
| 3 | `\ue903 ` | `U+E903` | glyph 7 | 半角空格 |
| 4 | `\ue904 ` | `U+E904` | glyph 8 | 半角空格 |

- 5 帧组成一个跑步循环。
- 所有码位都在 **Unicode 私有区（PUA, U+E000–U+F8FF）**，没有标准字形，**必须安装 `assets/runcat.ttf`** 才能显示，否则是方块/空白。
- 每帧末尾的空格是刻意加的，给猫和后面的速度数字之间留间距。

字体 `cmap` 表（已解析确认）总共只有 8 个 glyph：`.notdef`、`.null`、space、以及上述 5 帧。

## 2. 字体文件

- 路径：`assets/runcat.ttf`（3532 字节，非常小）
- 安装目标：
  - macOS：`~/Library/Fonts/runcat.ttf`
  - Linux：`~/.local/share/fonts/runcat.ttf`（装完跑 `fc-cache -f`）
- 安装脚本：`scripts/install-font.mjs`（npm `postinstall` 自动跑）
- 上游灵感：[`FredySandoval/pi-runcat`](https://github.com/FredySandoval/pi-runcat)

## 3. 帧率映射公式

```ts
function runcatInterval(config, speed) {
  if (speed == null || !isFinite(speed) || speed <= 0) return config.defaultRuncatIntervalMs;
  return Math.max(
    config.minRuncatIntervalMs,
    Math.min(config.maxRuncatIntervalMs, Math.round(config.runcatScale / speed)),
  );
}
```

默认参数（`config.ts` 的 `DEFAULT_CONFIG`）：

| 参数 | 默认值 | 作用 |
| ---- | ------ | ---- |
| `runcatScale` | `6000` | 分子常数 |
| `minRuncatIntervalMs` | `50` | 帧间隔下限（20 FPS，最快） |
| `maxRuncatIntervalMs` | `250` | 帧间隔上限（4 FPS，最慢） |
| `defaultRuncatIntervalMs` | `167` | 无速度时的默认间隔（≈6 FPS） |

换算表（`intervalMs = clamp(6000 / tokS, 50, 250)`）：

| tok/s | intervalMs | FPS |
| ----- | ---------- | --- |
| —（null） | 167 | 6.0 |
| 24 | 250（撞 max） | 4.0 |
| 30 | 200 | 5.0 |
| 40 | 150 | 6.7 |
| 60 | 100 | 10.0 |
| 120 | 50（撞 min） | 20.0 |

> 24 tok/s = 最慢散步，120 tok/s = 全速狂奔，正好覆盖主流模型的真实输出区间。

## 4. Badge 图标预设

`src/presets.ts` 的 `ICON_PRESETS`（速度数字前缀的图标，和 RunCat 是两回事）：

```
none  ✦  ◆  ◇  ◈  ⌁  ≋  ›  ⟡  ฅ  🐾
󰓅  󱐋  󰄛  󰣇  󰊬       (Nerd Font PUA 图标)
```

后 5 个是 Nerd Font 私有码位，装了 Nerd Font 才显示。

`display.ts` 里对图标有个特殊处理：如果 icon 是「成对的 PUA 字符」（长度 2 且以 `\ue0b6`/`\ue0b5` 这种 powerline 边框开头），会渲染成「左框 + 速度 + 右框」的胶囊样式，而不是「图标 + 空格 + 速度」。

## 5. 标签 / 前缀预设（猫味彩蛋）

可选的「单位标签」（替换 `tok/s`，共 31 个）：

```
tok/s  zoomies/s  nyooms/s  brrrs/s  purrs/s  meows/s  mlems/s  beans/s
paws/s  scritches/s  kibbles/s  treats/s  pounces/s  loaves/s  whiskers/s
tailwags/s  catnips/s  goblins/s  chaoses/s  thoughts/s  braincells/s
vibes/s  yaps/s  noms/s  tunas/s  hairballs/s  boops/s  bonks/s  zips/s
skitters/s  scampers/s
```

可选的 working 前缀（21 个）：

```
Working...  Catting...  Nyooming...  Cooking...  Zooming...  Purring...
Chasing tokens...  Doing zoomies...  Cat go brrr...  Generating chaos...
Tiny legs running...  Summoning cats...  Kneading thoughts...  Hunting tokens...
Spinning yarn...  Loafing hard...  Turbo loaf...  Pawing at logits...
Whiskers engaged...  Brain cat running...  Serving kibble...
```

> 这两组预设支持 `Random` 模式：在每次 `agent_start` 时随机挑一个，整轮对话固定不变（见 `index.ts` 的 `chooseOccurrenceText` + `ensureOccurrence`）。

## 6. 复用 checklist

要在本仓库做一个同类 spinner/速度指示器：

- [ ] 引擎：直接移植 `TokenSpeedEngine`（纯类，无依赖，已带测试）
- [ ] 帧数组：用 PUA 码位 + 自带 ttf，或换成 Unicode 既有符号（如 `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` Braille —— 本仓库 `common/spinner.ts` 里已经有 ~60 种现成的）
- [ ] 帧率映射：照搬 `runcatInterval`，按自己动画的舒适区间调 scale/min/max。**本仓库 `SpinnerStyle.intervalMs` 目前是写死的数字，要支持速度自适应需要加一个函数字段**
- [ ] 渲染：本仓库 `packages/working-indicator/index.ts` 已有 `ctx.ui.setWorkingIndicator` 调用，但只在 `session_start` 调一次；要动态调需要在 `message_update` 里按速度重设
- [ ] 字体安装：参考 `scripts/install-font.mjs`（macOS + Linux 双平台 + fc-cache）
- [ ] 去抖：interval 变化 <10ms 不重设 `setWorkingIndicator`

> 本仓库与 pi-speeed 的关键差异：`packages/working-indicator` + `common/spinner.ts` 是**固定帧率** spinner，没有速度感知；pi-speeed 的核心增量就是「tok/s → 帧率」的反比映射。详见 `ANALYSIS.md` §3.0。
