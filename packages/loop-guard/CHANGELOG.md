# Changelog

## [Unreleased]

### Changed

- Default `allowedTools` now also exempts `wiki_ingest`: when many Source Packets are pending, the model legitimately fans out repeated `wiki_ingest` calls to start multiple ingest tasks, which previously fell inside loop detection.

## [0.6.1] - 2026-09-01

### Added

- `allowedTools` config (comma-separated, default `subagent_status`): tool names exempt from loop detection. Exempt calls are never blocked and are not recorded in the history window, so legitimate polling (e.g. `subagent_status` on a background subagent that keeps returning "running") is not cut off at `maxRepeats`, and heavy polling cannot flush real signal out of the `windowSize` history.

## [0.5.0] - 2026-08-12

### Added

- Initial `loop-guard` extension. Detects LLM "doom loops" and circular reasoning, then interrupts them with feedback. Pure detector cores (`ToolLoopDetector`, `ThinkingLoopDetector`) wired to pi events in `src/index.ts`.
- Tool-call loop detection on `tool_call` / `tool_result`: a call is only counted as a loop iteration when the tool, arguments, **and** result are all identical (result-hash grouping), so read-after-edit style iteration is not flagged. Exact-repeat detection blocks the Nth identical call (`maxRepeats`, default 3); ping-pong detection blocks fixed `A,B,A,B` alternation cycles (`pingPongMinCycles`, default 3) and is checked first so cycles get the more specific diagnosis. History is a sliding window (`windowSize`, default 30). Blocked calls return a `{ block, reason }` whose reason text becomes the tool result, telling the model to change approach or surface the deadlock to the user.
- Thinking loop detection on `message_end`: reasoning paragraphs (blank-line separated, whitespace-normalized, `thinkingMinChunkChars` default 200) are hashed and compared within a single assistant message and against recent assistant messages (`thinkingAcrossRepeatLimit`, `thinkingHistoryMessages`). Detected thinking loops raise a warning notification; consecutive duplicate notifications for the same detection kind are suppressed.
- Streaming-time loop detection on `message_update` (ported from [pi-loop-police](https://github.com/sebaxzero/pi-loop-police)): every `streamStride` (default 50) newly streamed characters, the growing thinking/text block is checked for a tail ending in two adjacent identical blocks of `streamMinWindow`–`streamMaxWindow` chars (default 80–2000; Z-array over the reversed tail, smallest period wins, trailing run collapsed to a single copy). On a hit the stream is aborted via `ctx.abort()` — the only intervention that works when the model loops forever and `message_end` never fires. On the subsequent `message_end` the repeated section is replaced with one copy plus a `[loop-guard: ... truncated]` label (returning `{message}`), a stream-specific recovery message (`THINKING LOOP DETECTED` / `OUTPUT LOOP DETECTED`) is injected through the same escalation/cap path as thinking loops, and a notification is shown. Config for `message_update` is cached per turn (`turn_start`) so extensions.json is not re-read per delta. New config: `streamDetectionEnabled`, `streamMinWindow`, `streamMaxWindow`, `streamStride`.
- Thinking-loop recovery injection (inspired by [pi-loop-police](https://github.com/sebaxzero/pi-loop-police)): when a thinking loop is detected and the response has no pending tool calls, a recovery message is injected via `pi.sendMessage(..., { triggerTurn: true, deliverAs: "followUp" })` (`customType: "loop-guard:recovery"`, `display: true`) so the model gets explicit "you are looping, change approach" feedback and can course-correct in a new turn. Consecutive detections escalate the wording (`LOOP PERSISTS (Nx)`); injections stop after `thinkingMaxInjections` consecutive detections (notifications continue) until a clean response resets the counter. Toggle: `thinkingInjectRecovery` (default on).
- Config surface via `registerConfigItems` (`/config`): `enabled`, `maxRepeats`, `pingPongMinCycles`, `windowSize`, `thinkingEnabled`, `thinkingMinChunkChars`, `thinkingAcrossRepeatLimit`, `thinkingHistoryMessages`, `thinkingInjectRecovery`, `thinkingMaxInjections`, `notifyOnDetect`. Master kill-switch via `isExtensionDisabled("loop-guard")`. Detector state resets on `session_start`.
- Custom transcript rendering for recovery messages: `loop-guard:recovery` messages are rendered via `registerMessageRenderer` as a content-fitting rounded box with a warning-colored border and a bold `loop-guard` title (instead of pi's default purple custom-message box). The `[loop-guard]` content prefix is stripped for display only; the model still receives the full recovery text.
