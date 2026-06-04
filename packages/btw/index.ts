import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import { showBtwOverlay } from "./btw-ui.ts";
import type { BtwTurn } from "./btw-ui.ts";

function registerBtwDemo(pi: ExtensionAPI): void {
  pi.registerCommand("btw-demo", {
    description: "Demo: show the /btw overlay with fake history",
    async handler(_args, ctx: ExtensionCommandContext) {
      if (!ctx.hasUI) {
        ctx.ui.notify("No UI available", "warning");
        return;
      }

      const fakeHistory: BtwTurn[] = [
        {
          userMessage: {
            role: "user",
            content: "What does the BtwTurn interface do?",
          } as UserMessage,
          assistantMessage: {
            role: "assistant",
            content:
              "It stores a Q&A pair — a user question and the assistant answer — for session-scoped /btw history.",
          } as unknown as AssistantMessage,
        },
        {
          userMessage: {
            role: "user",
            content: "How is scroll clipping implemented?",
          } as UserMessage,
          assistantMessage: {
            role: "assistant",
            content:
              "Build full natural[] lines, compute maxRows = floor(termRows × 0.85), then slice from top when natural.length > maxRows. The scrollOffset shifts the slice window.",
          } as unknown as AssistantMessage,
        },
      ];

      const controller = new AbortController();
      const { overlayPromise, controllerReady } = showBtwOverlay({
        ctx,
        question: "This is a demo question — how does the overlay look?",
        history: fakeHistory,
        controller,
        onClearHistory() {
          fakeHistory.length = 0;
        },
      });

      const ctrl = await controllerReady;

      setTimeout(() => {
        ctrl.setAnswer(
          "This is a simulated answer.\n\n" +
            "• The overlay should be anchored at the bottom\n" +
            "• Esc dismisses it\n" +
            "• ↑↓ scroll when content overflows\n" +
            "• x clears the history lines\n\n" +
            "The answer area is indented by 4 columns and word-wrapped to fit the terminal width.",
        );
      }, 1500);

      await overlayPromise;
    },
  });
}

export default function (pi: ExtensionAPI): void {
  registerBtwDemo(pi);
}
