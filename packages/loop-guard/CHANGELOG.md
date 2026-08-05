# Changelog

## [Unreleased]

### Added

- Initial `loop-guard` extension. Detects LLM "doom loops" and circular reasoning, then interrupts them with feedback. Pure detector cores (`ToolLoopDetector`, `ThinkingLoopDetector`) wired to pi events in `src/index.ts`.
- Tool-call loop detection on `tool_call` / `tool_result`: a call is only counted as a loop iteration when the tool, arguments, **and** result are all identical (result-hash grouping), so read-after-edit style iteration is not flagged. Exact-repeat detection blocks the Nth identical call (`maxRepeats`, default 3); ping-pong detection blocks fixed `A,B,A,B` alternation cycles (`pingPongMinCycles`, default 3) and is checked first so cycles get the more specific diagnosis. History is a sliding window (`windowSize`, default 30). Blocked calls return a `{ block, reason }` whose reason text becomes the tool result, telling the model to change approach or surface the deadlock to the user.
- Thinking loop detection on `message_end`: reasoning paragraphs (blank-line separated, whitespace-normalized, `thinkingMinChunkChars` default 200) are hashed and compared within a single assistant message and against recent assistant messages (`thinkingAcrossRepeatLimit`, `thinkingHistoryMessages`). Detected thinking loops raise a warning notification (pi has no API to block a finalized message); consecutive duplicate notifications for the same detection kind are suppressed.
- Config surface via `registerConfigItems` (`/config`): `enabled`, `maxRepeats`, `pingPongMinCycles`, `windowSize`, `thinkingEnabled`, `thinkingMinChunkChars`, `thinkingAcrossRepeatLimit`, `thinkingHistoryMessages`, `notifyOnDetect`. Master kill-switch via `isExtensionDisabled("loop-guard")`. Detector state resets on `session_start`.
