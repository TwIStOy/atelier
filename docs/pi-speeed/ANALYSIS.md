# pi-speeed 源码分析

> 分析对象：[`somus/pi-speeed`](https://github.com/somus/pi-speeed) @ `main`（commit `0044932`，v0.4.0）
> 仓库定位：一个 pi 扩展，在助手流式输出时实时显示 **tok/s**，并把速度映射到一只 **RunCat** 跑猫 spinner 的帧率。
> 本文档只解读「速度是怎么算出来的」和「spinner 图标是怎么定义/渲染的」两件事，并附上可直接复用的代码片段。

## 0. TL;DR

| 问题 | 答案 |
| --- | --- |
| 单个 token 怎么来的 | 优先用 provider 回传的 `usage.output`（增量差值）；否则本地按 `\w+\|[^\s\w]` 估算 |
| 实时速度怎么算 | 滑动窗口（默认 1000ms）内的 token 数 / 窗口时长；窗口未满时退化为「全程平均」 |
| 怎么防止瞬间尖刺 | `sanitizeTokS()`：duration < `minReliableDurationMs` 或 tok/s > `maxDisplayTokS` 一律返回 `null`（显示 `--`） |
| 单条消息最终速度 | `reconcileTotal(usage.output)` 校正 token 数后，`tokenCount / durationMs`，再 sanitize |
| session 平均速度 | 仅累加成功消息的 `tokens` 和 `durationMs`，最后 `sumTokens / sumDuration` |
| spinner 用的是什么 | 自带 **RunCat 字体**（`assets/runcat.ttf`）里 5 个私有码位 `U+E900..U+E904`，组成跑步动画的 5 帧 |
| spinner 帧率怎么变 | `intervalMs = clamp(runcatScale / tokS, min, max)`；速度越快帧越快，猫跑得越急 |
| 数字会不会跳 | 不会，所有显示值都过 `SpeedAnimator` 做线性插值缓动（默认 1800ms 到达目标） |

---

## 1. 速度计算

速度相关逻辑分布在三个文件，层次很清晰：

```
speed-tracker.ts   ← 对外门面：管理「单条消息」生命周期 + session 累计
   └─ engine.ts    ← 真正的 tok/s 引擎：token 计数、滑动窗口、sanitize
speed-animation.ts ← 纯插值器，让显示值平滑过渡（不参与速度本身的计算）
stats.ts / history.ts ← 落盘的聚合统计（totals / byModel / recent 200 条）
```

### 1.1 token 从哪来：`estimateTokensFromDelta`

`src/engine.ts`

```ts
export function estimateTokensFromDelta(text: string, strategy: Config["countStrategy"]) {
  if (!text) return 0;
  if (strategy === "direct") return 1;          // 每个 delta 当 1 个 token（最快最糙）
  const matches = text.match(/\w+|[^\s\w]/g);   // 估算：词 + 标点各算 1
  return matches ? matches.length : 0;
}
```

两条路径，由 `config.countStrategy` 和 `config.useProviderTokens` 决定：

- **`useProviderTokens: true`（默认）** —— 不看 delta 文本，直接吃 provider 回传的 `partial.usage.output`。
  `recordDelta()` 会记住「上次累计的 usage」，只把**增量**记进去，避免重复计数：

  ```ts
  if (this._config.useProviderTokens && usageOutput !== undefined && usageOutput > this._countedUsageOutput) {
    this.recordTokens(usageOutput - this._countedUsageOutput);
    this._countedUsageOutput = usageOutput;
    return;
  }
  ```

- **`useProviderTokens: false` / 没有 usage 时** —— 用 `estimateTokensFromDelta()` 本地估算 token 数。
  `estimate` 策略把一段文本切成「词 + 非空白非词字符」，数有几个；`direct` 策略则把每个 delta chunk 直接当 1 个 token（最省事的兜底）。

> 也就是说：**在 provider 给 usage 的情况下，pi-speeed 显示的就是接近真实的 output token 数**；只有 provider 不给 usage 时才退化到本地估算。

### 1.2 引擎状态：`TokenSpeedEngine`

`src/engine.ts`。引擎在每个 assistant message 开始时 `start()`，结束时 `stop()`。核心状态：

- `_tokenCount` —— 累计 token 数
- `_startTime` / `_endTime` —— 起止时间（流式时 `_endTime` 实时取 `Date.now()`）
- `_events: TokenEvent[]` —— `{time, tokens}` 数组，每个 token 批次记一条，**用于滑动窗口**
- `_windowStartIndex` —— 窗口左边界指针（单调前移，配合 `compact()` 避免数组无限增长）
- `_lastStableTokS` —— 上一个通过 sanitize 的稳定值，作为「脏值兜底」

#### 1.2.1 实时速度：滑动窗口 `tokS`

实时显示用的速度是这个 getter，是整个项目的核心算法：

```ts
get tokS() {
  const candidate = this.rawTokS;
  const stable = this.sanitizeTokS(candidate);
  if (stable !== null) this._lastStableTokS = stable;
  return this._lastStableTokS;   // 注意：脏值不更新稳定值，而是沿用上一个稳定值
}

get rawTokS() {
  // 1) 还没跑过一个窗口时间 → 用全程平均，避免早期数据太少
  if (this.elapsedMs < this._config.slidingWindowMs) return this.avgTokS;
  // 2) 已停止 → 用全程平均
  if (!this._isStreaming) return this.avgTokS;

  const now = Date.now();
  const windowStart = now - this._config.slidingWindowMs;

  // 3) 把早于窗口左边界的事件剔除（指针前移）
  while (this._windowStartIndex < this._events.length
         && this._events[this._windowStartIndex].time < windowStart) {
    this._windowStartIndex++;
  }
  // 窗口里没有点了 → 退回全程平均
  if (this._windowStartIndex >= this._events.length) return this.avgTokS;

  // 4) 求窗口内 token 总数
  let windowTokenCount = 0;
  for (let i = this._windowStartIndex; i < this._events.length; i++) {
    windowTokenCount += this._events[i].tokens;
  }
  if (windowTokenCount === 0) return this.avgTokS;

  // 5) 窗口 token / 窗口时长 = 实时 tok/s
  const windowDuration = (now - this._events[this._windowStartIndex].time) / 1000;
  if (windowDuration <= 0) return 0;
  return windowTokenCount / windowDuration;
}
```

一句话：**最近 1 秒（`slidingWindowMs`）内到达的 token 数 ÷ 这段窗口的时长**。前 1 秒用全程平均做暖机。

`avgTokS` 就是 `_tokenCount / (elapsedMs/1000)`，全程平均，用于早期/停止时回退。

`_events` 数组有个 `compact()` 机制：当 `_windowStartIndex` 超过 5000 时把已滑出窗口的部分裁掉，防止长对话里数组无限膨胀。

#### 1.2.2 防尖刺：`sanitizeTokS`

```ts
sanitizeTokS(value: number | null, durationMs = this.elapsedMs) {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  if (durationMs < this._config.minReliableDurationMs) return null;  // 持续太短，不可信
  if (value > this._config.maxDisplayTokS) return null;              // 高得离谱，丢弃
  return value;
}
```

两条护栏，对应两种典型尖刺：

- **`minReliableDurationMs`（默认 1000ms）** —— 一个 delta 瞬间到了一堆 token，duration 才几十毫秒，算出来的 tok/s 上百万。直接判 `null`。
- **`maxDisplayTokS`（默认 500）** —— 即使过了暖机，单次窗口算出来的值超过 500 也认为是异常 burst，丢弃。

关键设计：**sanitize 返回 `null` 时不会清空显示**，而是沿用 `_lastStableTokS`（上一个可信值）。所以画面上不会因为一次抖动就闪成 `--`，而是「卡」在上一个稳定速度上，直到下一次可信样本到来。

测试 `engine.test.ts` 里 "avoids burst spikes from large single deltas" 正好验证这点：塞进 2000 个词、只过 10ms，`rawTokS` = 200000 但 `tokS` = 0（即用兜底稳定值 0）。

#### 1.2.3 消息结束的权威校正：`reconcileTotal`

单条 assistant message 结束时（`message_end` 事件），引擎拿到 `event.message.usage.output`（provider 给的最终权威 token 数），调用：

```ts
reconcileTotal(tokens: number) {
  if (tokens > 0) this._tokenCount = tokens;
}
```

直接把 `_tokenCount` 覆盖成权威值，再用 `tokenCount / durationMs` 算这条消息的最终 tok/s。这样即使流式过程中的增量计数有偏差（provider usage 跳变、本地估算误差），最终落盘的速度也是准的。

### 1.3 生命周期门面：`SpeedTracker`

`src/speed-tracker.ts`。对 `TokenSpeedEngine` 做了一层「消息级 + session 级」的封装：

| 方法 | 作用 |
| --- | --- |
| `startMessage()` | 引擎 `start()` |
| `recordDelta(delta, usageOutput)` | 转发给引擎 |
| `stopMessage()` | 引擎 `stop()`（保险） |
| `liveTokS()` | 实时速度：`engine.tokS > 0 ? engine.tokS : lastStableTokS` |
| `finishMessage(outputTokens, stopReason)` | 关键收尾：`reconcileTotal` → 算最终 tok/s → sanitize → 写入 `lastStableTokS` → 如果 `stopReason` 不是 `error`/`aborted`，则把 token 数和时长累加进 session 统计 → 返回 `CompletedMessageSpeed` |
| `sessionAvgTokS()` | `sessionOutputTokens / (sessionDurationMs/1000)` —— 仅含成功消息 |
| `resetSession()` | session 开头清零 |

注意 `finishMessage` 里的 stopReason 过滤：

```ts
if (tokS !== null && isSuccessfulStop(stopReason)) {
  this.sessionOutputTokens += tokens;
  this.sessionDurationMs += durationMs;
}
```

**被中断（`aborted`）或出错（`error`）的消息不会污染 session 平均速度**，但仍然会进 `lastStableTokS` 和聚合统计里的 `recent`（统计文件那边有自己的 `isSpeedEligible` 过滤 totals）。

### 1.4 显示平滑：`SpeedAnimator`

`src/speed-animation.ts`。和速度计算无关，纯粹是为了让画面上的数字不要跳。

它是一个**线性插值器**：记住 `from`（起点）、`target`（目标）、`startedAt`（开始时间），`value(now)` 在 `durationMs` 内从 `from` 线性过渡到 `target`。

- `setTarget(t)`：如果当前已经在动画中，**从当前插值位置**重新开始一段到 `t` 的过渡，而不是从原起点硬切。
- `reset(v)`：直接把 from=target=v，瞬移。
- 新 target 与当前 target 差距 < 0.05 时忽略，避免无意义的小数位抖动。

项目里有**两个** animator 实例：
- `liveSpeedAnimator` —— 流式过程中的工作区数字
- `footerSpeedAnimator` —— footer 里的 session 平均数字（消息结束时才更新一次，靠 footer animation timer 跑完过渡）

### 1.5 整体时序（`src/index.ts`）

把事件 hook 串起来看最清楚：

```
session_start   → 重载 config、resetSession、footer animator reset
agent_start     → 选一次 label/workingPrefix（Random 模式整轮固定）、reset UI
turn_start      → reset UI
message_start   (assistant) → speedTracker.startMessage()、启动 live animation timer
message_update  (assistant) →
    text_delta/thinking_delta → speedTracker.recordDelta(delta, usage.output)
    每 renderIntervalMs 渲染一次 renderLiveSpeed()
message_end     (assistant) →
    finishMessage(usage.output, stopReason)
    recordCompletedMessageSpeed(...)  ← 落盘统计
    footer animator.setTarget(sessionAvgTokS())
turn_end        → stopMessage、停 live timer
agent_end       → stopMessage、停 live timer、清 working message
session_shutdown→ 停所有 timer、清 UI
```

渲染节流：`message_update` 里有个 `lastRenderedAt`，只有距上次渲染超过 `renderIntervalMs`（默认 250ms）才真正重绘，避免每个 delta 都重画。

---

## 2. RunCat Spinner

### 2.1 帧的定义

`src/runcat.ts`：

```ts
export const RUNCAT_FRAMES = ["\ue900 ", "\ue901 ", "\ue902 ", "\ue903 ", "\ue904 "];
```

5 帧，每帧是一个**私有区（Private Use Area）码位 + 一个空格**：

| 帧 | 码位 | 说明 |
| --- | --- | --- |
| 0 | `U+E900 ` | RunCat 跑步姿态 1 |
| 1 | `U+E901 ` | RunCat 跑步姿态 2 |
| 2 | `U+E902 ` | RunCat 跑步姿态 3 |
| 3 | `U+E903 ` | RunCat 跑步姿态 4 |
| 4 | `U+E904 ` | RunCat 跑步姿态 5 |

> 这 5 个 PUA 字符本身没有 Unicode 含义，**字形完全由字体文件 `assets/runcat.ttf` 提供**。终端必须装了这个字体才能看到猫，否则显示成方块 `□` 或空白。

我直接解析了 `runcat.ttf` 的 `cmap` 表确认（cmap format 4），字体里一共就 8 个 glyph：

| 码位 | glyph |
| --- | --- |
| U+0000 | glyph 1 (.notdef) |
| U+0001 | glyph 2 (.null) |
| U+0020 | glyph 3 (space) |
| **U+E900** | glyph 4 (frame 0) |
| **U+E901** | glyph 5 (frame 1) |
| **U+E902** | glyph 6 (frame 2) |
| **U+E903** | glyph 7 (frame 3) |
| **U+E904** | glyph 8 (frame 4) |

字体来源 README 里写了：灵感来自 [`FredySandoval/pi-runcat`](https://github.com/FredySandoval/pi-runcat)，那个又追溯到 macOS 著名的 RunCat 菜单栏 app。

### 2.2 帧率映射：`runcatInterval`

```ts
export function runcatInterval(config: Config, speed: number | null) {
  if (speed === null || !Number.isFinite(speed) || speed <= 0) return config.defaultRuncatIntervalMs;
  return Math.max(
    config.minRuncatIntervalMs,
    Math.min(config.maxRuncatIntervalMs, Math.round(config.runcatScale / speed)),
  );
}
```

默认值（`config.ts`）：

| 配置 | 默认值 | 含义 |
| --- | --- | --- |
| `defaultRuncatIntervalMs` | 167 | 没有有效速度时（speed=null）的帧间隔 ≈ 6 FPS |
| `minRuncatIntervalMs` | 50 | 最快帧间隔（猫全速狂奔）= 20 FPS |
| `maxRuncatIntervalMs` | 250 | 最慢帧间隔 = 4 FPS |
| `runcatScale` | 6000 | 速度→帧间隔的缩放常数 |

公式：`intervalMs = clamp(6000 / tokS, 50, 250)`。**tok/s 越大，间隔越小，猫跑得越快。**

几个典型点（测试 `runcat.test.ts` 印证）：

| tok/s | intervalMs | 帧/秒 |
| --- | --- | --- |
| null | 167（default） | 6 |
| 30 | 200 | 5 |
| 120 | 50（撞到 min） | 20 |
| 24 | 250（撞到 max） | 4 |
| 60 | 100 | 10 |

> 即 24 tok/s 是猫「最慢散步」的临界点，120 tok/s 是猫「全速狂奔」的临界点，覆盖了真实模型输出速度的典型区间（十几到一两百 tok/s）。

### 2.3 何时重设 spinner：`applyRunCatIndicator`

```ts
export function applyRunCatIndicator(ctx, config, state, speed = null, force = false) {
  if (!ctx.hasUI || !ctx.ui.setWorkingIndicator) return;
  if (!config.runcat) { ctx.ui.setWorkingIndicator(); return; }   // 关闭：清空
  const nextInterval = runcatInterval(config, speed);
  const intervalChanged = Math.abs(nextInterval - state.intervalMs) >= 10;
  if (!force && !intervalChanged) return;                          // 变化 <10ms 不重设，省调用

  const indicator: WorkingIndicatorOptions = {
    frames: RUNCAT_FRAMES.map((frame) => ctx.ui.theme.fg("accent", frame)),  // 每帧套主题 accent 色
    intervalMs: nextInterval,
  };
  ctx.ui.setWorkingIndicator(indicator);
  state.intervalMs = nextInterval;
}
```

两个细节：

1. **去抖**：只有当算出的新间隔与当前间隔差 ≥ 10ms 才真正调用 `setWorkingIndicator`，否则什么都不做。避免每个 delta 都重设帧动画器。
2. **着色**：每帧都用 `ctx.ui.theme.fg("accent", frame)` 包上主题强调色，猫是跟着主题走的。

调用点（`index.ts`）：
- `renderLiveSpeed()` 每次渲染时传当前实时 speed
- `refreshRunCat()` 在 agent_start/turn_start/message_end 等节点用 `speedTracker.lastTokS`（上一个稳定值）或 `null` 重设
- `applyConfig()` 配置变更后 force 重设

---

## 3. 复用建议（针对本仓库）

### 3.0 本仓库现状对照

本仓库**已经有**一个 working-indicator 系统，但它和 pi-speeed 是两种不同范式：

| 维度 | 本仓库 `extensions/working-indicator` + `common/spinner.ts` | pi-speeed RunCat |
| ---- | -------------------------------------------------------- | ---------------- |
| 帧率 | **固定**（每个 style 写死 `intervalMs`） | **速度自适应**（`intervalMs = 6000/tokS`） |
| 帧来源 | 标准 Unicode 符号（Braille dots、emoji、几何符号等，共 ~60 种） | 自带 ttf 的 PUA 码位（5 帧跑步猫） |
| 状态信息 | working message 里显示「phrase + thinking 秒数」 | working message 里显示「phrase + 实时 tok/s」 |
| 速度感知 | ❌ 无 | ✅ 有滑动窗口 tok/s 引擎 |

**pi-speeed 最值得借鉴的就是「让 spinner 帧率跟随输出速度」这一机制**——本仓库的 spinner 系统目前缺这一层。如果要把 RunCat 式自适应帧率嫁接进来，最小改动是：

1. 在 `common/spinner.ts` 的 `SpinnerStyle` 里允许 `intervalMs` 是一个函数 `(tokS: number | null) => number`，或新增一个 `dynamic` 字段；
2. 在 `working-indicator` 里接入一个 tok/s 引擎（见下），按 `runcatInterval` 公式动态调 `setWorkingIndicator`；
3. 直接复用下面 3.1 的 `TokenSpeedEngine`。

### 3.1 速度引擎（强烈推荐照搬）

`engine.ts` 的 `TokenSpeedEngine` 是**纯类、无 pi 依赖、无 IO**，输入是 `recordTokens()` / `recordDelta()`，输出是 `tokS` / `avgTokS` / `tokenCount`。配合默认配置直接可用：

```ts
const engine = new TokenSpeedEngine({
  slidingWindowMs: 1000,       // 滑动窗口
  minReliableDurationMs: 1000, // 暖机阈值
  maxDisplayTokS: 500,         // 上限封顶
  useProviderTokens: true,     // 吃 provider usage
  countStrategy: "estimate",   // 本地兜底策略
});
```

测试 `engine.test.ts` 已经覆盖了暖机抑制、滑动窗口、增量 usage、reconcile、burst 抑制五种场景，搬过来就有保障。

### 3.2 PUA 字体 spinner 模式

RunCat 的玩法本质是 **「自定义 ttf + PUA 码位 + 帧数组 + intervalMs 映射」**。要换一套动画（比如小狗、火箭、加载条），只需：

1. 造一个自己的 `.ttf`，把 N 帧画到 `U+E900..` 开始的 PUA 区；
2. 改 `RUNCAT_FRAMES` 数组；
3. 改 `runcatInterval` 里的 scale/min/max。

字体安装脚本 `scripts/install-font.mjs` 也是现成的跨平台（macOS `~/Library/Fonts`、Linux `~/.local/share/fonts` + `fc-cache`）模板。

> ⚠️ 注意：pi-speeed 用的 `ctx.ui.setWorkingIndicator` 是 pi 的 TUI API。本仓库里如果要往 statusline/working 区域写，需要先确认 pi 暴露了等价接口（见 `pi-self-extension` skill）。

### 3.3 预设素材

`presets.ts` 里还有一堆现成的预设可参考：
- `LABEL_PRESETS` —— 31 个「单位」标签（`tok/s`、`zoomies/s`、`nyooms/s`、`brrrs/s` …猫味十足）
- `WORKING_PREFIX_PRESETS` —— 21 个 working 前缀（`Working...`、`Catting...`、`Purring...` …）
- `ICON_PRESETS` —— badge 图标（`✦ ◆ ◇ ◈ ⌁ ≋ › ⟡ ฅ 🐾` + 一堆 Nerd Font PUA 图标）

---

## 4. 一句话总结

pi-speeed 的速度算法可以概括成一句话：

> **「最近 1 秒到达的 token 数 ÷ 1 秒」做实时速度，全程平均做暖机/兜底，sanitize 用最小时长 + 最高速两道闸门过滤尖刺，消息结束时用 provider 的权威 usage 校正落盘；RunCat 是 5 个字体私有码位，帧率 = clamp(6000/tokS, 50, 250) 反比映射。**

源码组织得很干净，引擎/UI/统计完全解耦，适合作为「流式速度指示器」的参考实现。
