import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, it, vi } from "vitest";
import { DEFAULT_CONFIG, type LoopGuardConfig } from "../src/config.ts";
import extension from "../src/index.ts";

let mockConfig: LoopGuardConfig;

vi.mock("@htwang-contrib/common", () => ({
  isExtensionDisabled: () => false,
  isStaleCtxError: () => false,
  readConfig: () => mockConfig,
  registerConfigItems: () => {},
}));

type Handler = (event: never, ctx: never) => unknown;

interface SentMessage {
  message: { customType: string; content: string; display: boolean };
  options: { triggerTurn?: boolean; deliverAs?: string } | undefined;
}

function mockPi() {
  const onHandlers: Record<string, Handler> = {};
  const sent: SentMessage[] = [];
  const pi = {
    on(event: string, handler: Handler) {
      onHandlers[event] = handler;
    },
    sendMessage(message: SentMessage["message"], options: SentMessage["options"]) {
      sent.push({ message, options });
      return Promise.resolve();
    },
    registerMessageRenderer() {},
  };
  return { pi: pi as unknown as ExtensionAPI, onHandlers, sent };
}

function mockCtx() {
  const notify = vi.fn();
  const abort = vi.fn();
  return { ctx: { ui: { notify }, abort } as unknown as ExtensionContext, notify, abort };
}

const CHUNK_A = "A".repeat(240);
const CHUNK_B = "B".repeat(240);

function messageEnd(thinking: string, withToolCall = false) {
  const content: Record<string, unknown>[] = [{ type: "thinking", thinking }];
  if (withToolCall) {
    content.push({ type: "toolCall", id: "call-1", name: "read", arguments: { path: "/a" } });
  }
  return { type: "message_end", message: { role: "assistant", content } };
}

function toolCall(path = "/a") {
  return { type: "tool_call", toolCallId: `id-${path}`, toolName: "read", input: { path } };
}

function toolResult(path = "/a", text = "contents") {
  return {
    type: "tool_result",
    toolCallId: `id-${path}`,
    toolName: "read",
    input: { path },
    content: [{ type: "text", text }],
    isError: false,
  };
}

describe("loop-guard wiring", () => {
  beforeEach(() => {
    mockConfig = { ...DEFAULT_CONFIG };
  });

  it("injects a recovery message when a thinking loop is detected without pending tool calls", () => {
    const { pi, onHandlers, sent } = mockPi();
    extension(pi);
    onHandlers.message_end(messageEnd(`${CHUNK_A}\n\n${CHUNK_A}`) as never, mockCtx().ctx as never);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].message.customType, "loop-guard:recovery");
    assert.equal(sent[0].message.display, true);
    assert.equal(sent[0].options?.triggerTurn, true);
    assert.match(sent[0].message.content, /THINKING LOOP DETECTED/);
  });

  it("does not inject when the response has pending tool calls", () => {
    const { pi, onHandlers, sent } = mockPi();
    extension(pi);
    const { ctx, notify } = mockCtx();
    onHandlers.message_end(messageEnd(`${CHUNK_A}\n\n${CHUNK_A}`, true) as never, ctx as never);
    assert.equal(sent.length, 0);
    assert.equal(notify.mock.calls.length, 1);
  });

  it("escalates the recovery message on consecutive detections", () => {
    const { pi, onHandlers, sent } = mockPi();
    extension(pi);
    const { ctx } = mockCtx();
    onHandlers.message_end(messageEnd(`${CHUNK_A}\n\n${CHUNK_A}`) as never, ctx as never);
    onHandlers.message_end(messageEnd(`${CHUNK_B}\n\n${CHUNK_B}`) as never, ctx as never);
    assert.equal(sent.length, 2);
    assert.match(sent[1].message.content, /LOOP PERSISTS \(2x/);
  });

  it("resets escalation after a clean message", () => {
    const { pi, onHandlers, sent } = mockPi();
    extension(pi);
    const { ctx } = mockCtx();
    onHandlers.message_end(messageEnd(`${CHUNK_A}\n\n${CHUNK_A}`) as never, ctx as never);
    onHandlers.message_end(messageEnd(CHUNK_B) as never, ctx as never);
    onHandlers.message_end(messageEnd(`${CHUNK_A}\n\n${CHUNK_A}`) as never, ctx as never);
    assert.equal(sent.length, 2);
    assert.match(sent[1].message.content, /THINKING LOOP DETECTED/);
  });

  it("stops injecting after the consecutive injection cap", () => {
    mockConfig.thinkingMaxInjections = 2;
    const { pi, onHandlers, sent } = mockPi();
    extension(pi);
    const { ctx } = mockCtx();
    onHandlers.message_end(messageEnd(`${CHUNK_A}\n\n${CHUNK_A}`) as never, ctx as never);
    onHandlers.message_end(messageEnd(`${CHUNK_B}\n\n${CHUNK_B}`) as never, ctx as never);
    onHandlers.message_end(messageEnd(`${CHUNK_A}\n\n${CHUNK_B}\n\n${CHUNK_A}`) as never, ctx as never);
    assert.equal(sent.length, 2);
  });

  it("does not inject when recovery injection is disabled", () => {
    mockConfig.thinkingInjectRecovery = false;
    const { pi, onHandlers, sent } = mockPi();
    extension(pi);
    const { ctx, notify } = mockCtx();
    onHandlers.message_end(messageEnd(`${CHUNK_A}\n\n${CHUNK_A}`) as never, ctx as never);
    assert.equal(sent.length, 0);
    assert.equal(notify.mock.calls.length, 1);
  });

  it("blocks a repeated tool call with an explanatory reason", () => {
    const { pi, onHandlers } = mockPi();
    extension(pi);
    const { ctx } = mockCtx();
    assert.equal(onHandlers.tool_call(toolCall() as never, ctx as never), undefined);
    onHandlers.tool_result(toolResult() as never, ctx as never);
    assert.equal(onHandlers.tool_call(toolCall() as never, ctx as never), undefined);
    onHandlers.tool_result(toolResult() as never, ctx as never);
    const blocked = onHandlers.tool_call(toolCall() as never, ctx as never) as { block: boolean; reason: string };
    assert.equal(blocked.block, true);
    assert.match(blocked.reason, /did NOT run/);
  });

  it("resets detectors on session_start", () => {
    const { pi, onHandlers } = mockPi();
    extension(pi);
    const { ctx } = mockCtx();
    onHandlers.tool_call(toolCall() as never, ctx as never);
    onHandlers.tool_result(toolResult() as never, ctx as never);
    onHandlers.tool_call(toolCall() as never, ctx as never);
    onHandlers.tool_result(toolResult() as never, ctx as never);
    onHandlers.session_start({ type: "session_start", reason: "new" } as never, ctx as never);
    assert.equal(onHandlers.tool_call(toolCall() as never, ctx as never), undefined);
  });
});

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomText(length: number, seed: number): string {
  const rand = mulberry32(seed);
  let out = "";
  while (out.length < length) {
    out += String.fromCharCode(97 + Math.floor(rand() * 26));
  }
  return out;
}

const BLOCK_C = randomText(120, 5);
const BLOCK_D = randomText(120, 6);
const INTRO = "Let me think about this problem step by step. ";

function thinkingUpdate(text: string) {
  return {
    type: "message_update",
    message: { role: "assistant", content: [{ type: "thinking", thinking: text }] },
    assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "" },
  };
}

function textUpdate(text: string) {
  return {
    type: "message_update",
    message: { role: "assistant", content: [{ type: "text", text }] },
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "" },
  };
}

function messageEndWith(content: Record<string, unknown>[]) {
  return { type: "message_end", message: { role: "assistant", content } };
}

describe("loop-guard stream detection", () => {
  beforeEach(() => {
    mockConfig = { ...DEFAULT_CONFIG };
  });

  it("aborts a repeating thinking stream, sanitizes the message, and injects recovery", () => {
    const { pi, onHandlers, sent } = mockPi();
    extension(pi);
    const { ctx, abort, notify } = mockCtx();
    const looping = INTRO + BLOCK_C + BLOCK_C;
    onHandlers.message_update(thinkingUpdate(looping) as never, ctx as never);
    assert.equal(abort.mock.calls.length, 1);
    const result = onHandlers.message_end(
      messageEndWith([{ type: "thinking", thinking: looping }]) as never,
      ctx as never,
    ) as { message: { content: { type: string; thinking?: string }[] } };
    const thinking = result.message.content[0].thinking ?? "";
    assert.ok(thinking.startsWith(INTRO + BLOCK_C));
    assert.ok(!thinking.includes(BLOCK_C + BLOCK_C));
    assert.match(thinking, /truncated/);
    assert.equal(sent.length, 1);
    assert.match(sent[0].message.content, /THINKING LOOP DETECTED/);
    assert.equal(notify.mock.calls.length, 1);
  });

  it("uses output wording for a repeating text stream", () => {
    const { pi, onHandlers, sent } = mockPi();
    extension(pi);
    const { ctx, abort } = mockCtx();
    const looping = INTRO + BLOCK_C + BLOCK_C;
    onHandlers.message_update(textUpdate(looping) as never, ctx as never);
    assert.equal(abort.mock.calls.length, 1);
    const result = onHandlers.message_end(messageEndWith([{ type: "text", text: looping }]) as never, ctx as never) as {
      message: { content: { type: string; text?: string }[] };
    };
    assert.match(result.message.content[0].text ?? "", /truncated/);
    assert.match(sent[0].message.content, /OUTPUT LOOP DETECTED/);
  });

  it("does not abort when stream detection is disabled", () => {
    mockConfig.streamDetectionEnabled = false;
    const { pi, onHandlers, sent } = mockPi();
    extension(pi);
    const { ctx, abort } = mockCtx();
    onHandlers.message_update(thinkingUpdate(INTRO + BLOCK_C + BLOCK_C) as never, ctx as never);
    assert.equal(abort.mock.calls.length, 0);
    const result = onHandlers.message_end(
      messageEndWith([{ type: "thinking", thinking: INTRO + BLOCK_C + BLOCK_C }]) as never,
      ctx as never,
    );
    assert.equal(result, undefined);
    assert.equal(sent.length, 0);
  });

  it("does not abort non-repeating streams", () => {
    const { pi, onHandlers } = mockPi();
    extension(pi);
    const { ctx, abort } = mockCtx();
    onHandlers.message_update(thinkingUpdate(randomText(300, 1)) as never, ctx as never);
    onHandlers.message_update(thinkingUpdate(randomText(600, 2)) as never, ctx as never);
    assert.equal(abort.mock.calls.length, 0);
  });

  it("escalates across consecutive stream aborts", () => {
    const { pi, onHandlers, sent } = mockPi();
    extension(pi);
    const { ctx } = mockCtx();
    const first = INTRO + BLOCK_C + BLOCK_C;
    onHandlers.message_update(thinkingUpdate(first) as never, ctx as never);
    onHandlers.message_end(messageEndWith([{ type: "thinking", thinking: first }]) as never, ctx as never);
    onHandlers.turn_start({ type: "turn_start", turnIndex: 1, timestamp: 0 } as never, ctx as never);
    const second = INTRO + BLOCK_D + BLOCK_D;
    onHandlers.message_update(thinkingUpdate(second) as never, ctx as never);
    onHandlers.message_end(messageEndWith([{ type: "thinking", thinking: second }]) as never, ctx as never);
    assert.equal(sent.length, 2);
    assert.match(sent[1].message.content, /LOOP PERSISTS \(2x/);
  });
});
