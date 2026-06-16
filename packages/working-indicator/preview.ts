import type { ConfigItemPreview } from "@htwang-contrib/common";
import { resolveSpinner } from "./spinner.ts";

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

    return {
      render(width, theme) {
        syncTimer();
        const style = resolveSpinner(activeKey ?? "");
        const frame = style.frames[frameIndex] ?? style.frames[0] ?? "";
        const glyph = theme.fg("accent", theme.bold(frame));
        const meta = theme.fg(
          "muted",
          `  width ${style.width} · interval ${style.intervalMs}ms`,
        );
        const detail = theme.fg(
          "dim",
          `  ${activeKey ?? ""} · ${style.frames.length} frames`,
        );
        const line1 = `${glyph}${meta}`;
        return [
          line1.length > width ? line1.slice(0, width) : line1,
          detail.length > width ? detail.slice(0, width) : detail,
        ];
      },
      dispose: stopTimer,
    };
  };
}
