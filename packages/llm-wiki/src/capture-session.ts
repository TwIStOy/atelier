import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { type IsolatedSessionResult, runIsolatedSession } from "@htwang-contrib/common";
import { registerWebFetchTool, registerWebSearchTool } from "@htwang-contrib/web-tools";
import { resolveIngestModel } from "./config.ts";
import { registerWikiCaptureTool } from "./index.ts";
import { WIKI_SIDE_CALL_BASE_TOOLS, WIKI_SIDE_CALL_FACTORIES } from "./side-call-base.ts";

const CAPTURE_SYSTEM_PROMPT = [
  "You are the LLM Wiki capture agent, running in an isolated session.",
  "Your job is to capture the given input into the wiki as immutable Source Packet(s), then report the result.",
  "",
  "Classify the input you are given, then act:",
  '- an http(s) URL -> call `wiki_capture` once with sourceType "url" (pass it as `url`);',
  '- a path to an existing local .md/.txt FILE -> call `wiki_capture` once with sourceType "file" (pass it as `originPath`);',
  "- a path to a DIRECTORY -> use bash to recursively enumerate every .md and .txt file underneath it (e.g. `find <dir> -type f \\( -name '*.md' -o -name '*.txt' \\)`), then call `wiki_capture` once PER file with sourceType \"file\" and that file's path as `originPath`;",
  '- otherwise (plain text) -> call `wiki_capture` once with sourceType "text" (pass it as `text`).',
  "- a topic or search query (not a direct URL/file/dir/text) -> use `web_search` to find relevant URLs and `web_fetch` to read pages as needed, then capture the useful sources with `wiki_capture`;",
  "",
  "For a single source call the tool once; for a directory call it once per discovered file.",
  "After capturing, reply with a short summary: the Source Packet id and vault for a single source, or the count plus the ids for a directory.",
  "Do not ingest, do not create wiki pages, and do not do anything else.",
].join("\n");

const captureToolsFactory: ExtensionFactory = (pi: ExtensionAPI) => {
  registerWikiCaptureTool(pi);
  registerWebSearchTool(pi);
  registerWebFetchTool(pi);
};

export interface CaptureSessionInput {
  source: string;
}

export type CaptureSessionResult = IsolatedSessionResult;

export async function runCaptureSession(
  ctx: ExtensionContext,
  input: CaptureSessionInput,
  signal?: AbortSignal,
  onProgress?: (toolCalls: number) => void,
): Promise<CaptureSessionResult> {
  const source = input.source.trim();
  if (!source) {
    return { text: "", isError: true, errorMessage: "/wiki-capture: source argument is empty", toolCalls: 0 };
  }
  const task = `Capture the following input into the LLM Wiki using the wiki_capture tool, then report the result. The input may be a URL, a single .md/.txt file path, a directory (capture every .md/.txt file under it), or pasted text.\n\nInput:\n${source}`;
  return runIsolatedSession(
    ctx,
    {
      label: "/wiki-capture",
      extensionFactories: [...WIKI_SIDE_CALL_FACTORIES, captureToolsFactory],
      systemPrompt: CAPTURE_SYSTEM_PROMPT,
      task,
      model: resolveIngestModel(ctx) ?? undefined,
      allowedTools: [...WIKI_SIDE_CALL_BASE_TOOLS, "wiki_capture", "web_fetch", "web_search"],
      onProgress,
    },
    signal,
  );
}
