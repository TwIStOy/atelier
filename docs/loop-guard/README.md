# loop-guard

Detects when the LLM gets stuck in a loop — repeating identical tool calls or circular reasoning — and interrupts it.

Package: `packages/loop-guard` (`@htwang-contrib/loop-guard`).

## What it detects

### Exact-duplicate tool calls ("doom loop")

The classic stuck-agent pattern: `read` the same file, `grep` the same pattern, or retry the same failing `bash` command over and over.

A call only counts toward a loop when **tool + arguments + result are all identical** (results are hashed, including the error flag). This is the "no progress" signal: read-after-edit is safe because the second read returns different content. When the same call has already produced the same result `maxRepeats - 1` times, the next attempt is **blocked** before execution.

### Ping-pong tool calls

Alternating cycles `A,B,A,B,...` (e.g. edit → test → edit → revert) where both A and B return identical results every iteration. Checked *before* exact-repeat so a cycle gets the cycle-specific diagnosis rather than a plain "repeated call" on its third A.

### Streaming repetition (verbatim loops that never finalize)

The most dangerous loop: the model repeats the same text forever and the message never ends, so `message_end` detectors never get a chance to fire. On `message_update`, every `streamStride` newly streamed characters the growing thinking/text block is checked for a tail ending in two adjacent identical blocks of 80–2000 chars (Z-array over the reversed tail, smallest period wins). On a hit the stream is **aborted mid-generation** via `ctx.abort()`.

### Thinking repetition (reasoning models)

Reasoning paragraphs (blank-line separated, whitespace-normalized, at least `thinkingMinChunkChars` long) are hashed and compared:

- **within-message** — the same paragraph appears twice in one response (model stuck mid-thought, burning tokens).
- **across-turns** — paragraphs from earlier assistant messages reappear verbatim (model re-deriving the same thoughts each turn).

## What happens on detection

| Detection | Action |
| --- | --- |
| Tool-call loop | Call is blocked; the `reason` becomes the tool result, so the model sees "you are looping, change approach or tell the user" as the tool output. Plus a warning notification. |
| Streaming loop | Stream aborted via `ctx.abort()`. On `message_end` the repeated section is truncated to a single copy with a `[loop-guard: ... truncated]` label (so the model does not re-read its own loop), a stream-specific recovery message (`THINKING LOOP DETECTED` / `OUTPUT LOOP DETECTED`) is injected through the same escalation/cap path as thinking loops, plus a notification. |
| Thinking loop | **Recovery-message injection** plus a warning notification. Pi cannot block an already-finalized message, so instead loop-guard injects a recovery message (`customType: "loop-guard:recovery"`, visible in the transcript) with `triggerTurn: true` — the model gets explicit "you are looping" feedback and course-corrects in a new turn. Consecutive detections escalate the wording (`LOOP PERSISTS (Nx)` → tell the user and ask how to proceed). To prevent a runaway, injections stop after `thinkingMaxInjections` consecutive detections until a clean response resets the counter. Injection is skipped when the response still has pending tool calls (the tool-call guard owns that path). |

Blocked calls never execute, so they are not recorded in the detection history (pi does not fire `tool_result` for blocked calls).

## Configuration

All settings live in `/config` under "Loop Guard" (persisted to `~/.config/pi/extensions.json` under `loop-guard`):

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch for detection and blocking. |
| `maxRepeats` | `3` | Block the Nth call with identical args + identical results. Raise this if you do intentional polling (e.g. waiting on CI). |
| `pingPongMinCycles` | `3` | Block when an `A,B` alternation repeats this many times. |
| `windowSize` | `30` | Recent tool results kept for comparison; older calls are forgotten (this is also the escape hatch that lets a blocked call become callable again later). |
| `thinkingEnabled` | `true` | Enable reasoning-loop detection. |
| `thinkingMinChunkChars` | `200` | Minimum paragraph length considered; guards against trivial short repeats. |
| `thinkingAcrossRepeatLimit` | `1` | Distinct repeated paragraphs required to flag an across-turn loop. |
| `thinkingHistoryMessages` | `20` | Recent assistant messages kept for across-turn comparison. |
| `thinkingInjectRecovery` | `true` | Inject a recovery message (new turn) when a thinking loop is detected. |
| `thinkingMaxInjections` | `3` | Stop injecting after this many consecutive thinking loops until a clean response. |
| `streamDetectionEnabled` | `true` | Abort mid-stream when thinking/text repeats verbatim. |
| `streamMinWindow` | `80` | Minimum repeated block size (chars) that aborts the stream. |
| `streamMaxWindow` | `2000` | Maximum repeated block size considered; only the last 2x this many chars are examined. |
| `streamStride` | `50` | Run the stream check every N newly streamed characters. |
| `notifyOnDetect` | `true` | Show notifications on detection. |

The extension can also be disabled entirely via `isExtensionDisabled("loop-guard")` (see `docs/extension-disable/`).

## Architecture

```
src/
  signatures.ts     stableStringify / sha256 hashing / call summaries
  tool-loop.ts      ToolLoopDetector — pure, options passed per call
  thinking-loop.ts  ThinkingLoopDetector — pure, paragraph hashing
  stream-loop.ts    detectRepeatingSuffix — Z-array verbatim tail repetition detector
  recovery.ts       thinking/stream recovery message wording (escalation-aware)
  config.ts         LoopGuardConfig, defaults, ConfigItem registration
  index.ts          wiring: session_start/turn_start reset, tool_call block, tool_result record, message_update stream abort, message_end thinking scan + sanitize + recovery injection
```

Detectors are pure stateful classes with no pi dependencies; `index.ts` is a thin event adapter. State resets on `session_start`.

## Known limitations

- Parallel tool batches: identical calls issued in the same batch all pass `checkCall` before any result is recorded. Loops across turns (the common case) are unaffected.
- A determined 2-cycle can partially evade ping-pong detection after the first block (the blocked call leaves a gap in the alternation). The exact-repeat backstop still catches it as identical results accumulate.
- Near-duplicate detection (fuzzy args like `ls -l` vs `ls -la`) is out of scope; signatures are exact.
- Stream detection is verbatim-only: a loop that paraphrases itself (semantic loop) is not caught mid-stream. pi-loop-police's incremental paragraph-fingerprint variant is possible future work.
- The recovery injection starts a new agent turn automatically; if the model ignores the message, `thinkingMaxInjections` caps the token burn.
