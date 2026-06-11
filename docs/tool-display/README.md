# tool-display — 注册外部 Adapter

`@htwang-contrib/tool-display` 通过 pi 的 `EventBus` 支持外部扩展注册自定义的 tool 显示 adapter，无需共享模块实例。

## 接口

外部 adapter 需要实现 `ToolDisplayAdapter` 接口（structural typing，不需要安装 `@htwang-contrib/tool-display` 作为依赖）：

```typescript
interface ToolDisplayAdapter<TArgs = Record<string, unknown>> {
  formatCallHeader(
    args: TArgs,
    theme: Theme,
    details?: unknown,
    isPartial?: boolean,
    expanded?: boolean,
  ): string;

  formatCollapsedContent(
    args: TArgs,
    output: string,
    theme: Theme,
    width: number,
    details?: unknown,
    isPartial?: boolean,
    spinAt?: number,
  ): string[];

  formatExpandedContent(
    args: TArgs,
    output: string,
    theme: Theme,
    width: number,
    details?: unknown,
  ): string[];
}
```

`Theme` 来自 `@earendil-works/pi-coding-agent`（pi 的 peer dependency），提供 `theme.fg(color, text)`、`theme.bg(color, text)`、`theme.bold(text)` 等方法。

## 注册方式

在扩展的初始化函数中，通过 `pi.events` 注册：

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const myAdapter = {
  formatCallHeader(args, theme, details, isPartial, expanded) {
    return theme.bold(`MyTool(${JSON.stringify(args)})`);
  },
  formatCollapsedContent(args, output, theme, width, details, isPartial, spinAt) {
    return [theme.fg("muted", "  collapsed preview")];
  },
  formatExpandedContent(args, output, theme, width, details) {
    return output.split("\n").map((line) => theme.fg("toolOutput", line));
  },
};

export default function (pi: ExtensionAPI) {
  pi.events.emit("tool-display:register", {
    toolName: "my_tool",
    adapter: myAdapter,
  });
}
```

## 时序

1. pi 按路径顺序加载所有扩展
2. `tool-display` 初始化时 emit `tool-display:ready`，同时开始监听 `tool-display:register`
3. 外部扩展通过 `pi.events.emit("tool-display:register", ...)` 注册 adapter

因为 `pi.events.emit` 是同步 fire-and-forget，如果外部扩展在 `tool-display` 之前加载，emit 的信号会丢失。两种处理方式：

- **推荐**：监听 `tool-display:ready` 信号后再注册，确保 `tool-display` 已经在监听
- 或者在 `session_start` / `before_agent_start` 等生命周期事件中延迟注册（此时所有扩展已加载完毕）

### 监听 ready 信号注册

```typescript
export default function (pi: ExtensionAPI) {
  const register = () => {
    pi.events.emit("tool-display:register", {
      toolName: "my_tool",
      adapter: myAdapter,
    });
  };

  // 如果 tool-display 已经加载，直接注册
  // 如果还没加载，等 ready 信号
  pi.events.on("tool-display:ready", register);
  register();
}
```

这样无论加载顺序如何都能注册成功。
