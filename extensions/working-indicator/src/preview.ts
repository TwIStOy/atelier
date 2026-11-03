import type { ConfigItemPreview } from "@htwang-contrib/common";
import { resolveSpinner } from "@htwang-contrib/common";

function clipLine(line: string, width: number): string {
  return line.length > width ? line.slice(0, width) : line;
}

export function createSpinnerPreview(): ConfigItemPreview {
  return ({ getValue, requestRender }) => {
    let frameIndex = 0;
    let activeKey: string | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;

    const stopTimer = (): void => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };

    const syncTimer = (): void => {
      const key = String(getValue() ?? "");
      if (key === activeKey) return;
      activeKey = key;
      stopTimer();
      const style = resolveSpinner(key);
      frameIndex = 0;
      if (style.frames.length > 1) {
        timer = setInterval(() => {
          frameIndex = (frameIndex + 1) % style.frames.length;
          requestRender();
        }, style.intervalMs);
      }
    };

    const frameOf = (frames: string[]): string => frames[frameIndex] ?? frames[0] ?? "";

    return {
      render(width, theme) {
        syncTimer();
        const style = resolveSpinner(activeKey ?? "");
        const frame = frameOf(style.frames);
        const glyph = theme.fg("accent", theme.bold(frame));
        const meta = theme.fg("muted", `  width ${style.width} · interval ${style.intervalMs}ms`);
        const detail = theme.fg("dim", `  ${activeKey ?? ""} · ${style.frames.length} frames`);
        return [clipLine(`${glyph}${meta}`, width), clipLine(detail, width)];
      },
      dispose: stopTimer,
    };
  };
}
