import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { type IsolatedSessionResult, runIsolatedSession } from "@htwang-contrib/common";
import { registerWikiCaptureTool } from "./index.ts";

const CAPTURE_SYSTEM_PROMPT = [
  "You are the LLM Wiki capture agent, running in an isolated session.",
  "Your only job is to capture ONE source into the wiki as an immutable Source Packet, then report the result.",
  "",
  "Call the `wiki_capture` tool exactly once. Pick sourceType from the source you are given:",
  '- an http(s) URL -> sourceType "url" (pass it as `url`);',
  '- a path to an existing local .md/.txt file -> sourceType "file" (pass it as `originPath`);',
  '- otherwise treat the input as pasted text -> sourceType "text" (pass it as `text`).',
  "",
  "After the tool returns, reply with one short line: the Source Packet id and the vault it landed in.",
  "Do not read files, do not ingest, do not create pages, do not do anything else.",
].join("\n");

const captureToolsFactory: ExtensionFactory = (pi: ExtensionAPI) => {
  registerWikiCaptureTool(pi);
};

export interface CaptureSessionInput {
  source: string;
}

export type CaptureSessionResult = IsolatedSessionResult;

export async function runCaptureSession(
  ctx: ExtensionContext,
  input: CaptureSessionInput,
  signal?: AbortSignal,
): Promise<CaptureSessionResult> {
  const source = input.source.trim();
  if (!source) {
    return { text: "", isError: true, errorMessage: "/wiki-capture: source argument is empty", toolCalls: 0 };
  }
  const task = `Capture the following source into the LLM Wiki as an immutable Source Packet using the wiki_capture tool, then report the packet id.\n\nSource:\n${source}`;
  return runIsolatedSession(
    ctx,
    { label: "/wiki-capture", extensionFactories: [captureToolsFactory], systemPrompt: CAPTURE_SYSTEM_PROMPT, task },
    signal,
  );
}
