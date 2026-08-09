import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MB = 1024 * 1024;
const chunks: string[] = [];

function heapMb(): number {
  return Math.round(process.memoryUsage().heapUsed / MB);
}

export default function heapProbe(pi: ExtensionAPI): void {
  pi.registerCommand("heap-probe", {
    description:
      "Diagnostic: inflate JS heap by N MB without adding messages, to isolate GC (heap) vs rendering (message count) as editor-lag cause. Usage: /heap-probe <MB> | /heap-probe 0",
    async handler(args, ctx) {
      const raw = args.trim();
      const target = Number(raw);

      if (raw === "" || raw === "0" || raw === "clear" || !Number.isFinite(target) || target <= 0) {
        chunks.length = 0;
        ctx.ui.notify(`heap-probe: released. heapUsed now ${heapMb()}MB`, "info");
        return;
      }

      const before = heapMb();
      chunks.length = 0;
      const count = Math.floor(target);
      for (let i = 0; i < count; i++) {
        chunks.push("x".repeat(MB));
      }
      ctx.ui.notify(
        `heap-probe: +${count}MB resident (no messages added). heapUsed ${before}->${heapMb()}MB. Type to test: lag => GC(heap); smooth => rendering(msg count).`,
        "info",
      );
    },
  });
}
