# loop-guard

Detects when the LLM gets stuck in a loop — repeating identical tool calls or circular reasoning — and interrupts it.

Package: `packages/loop-guard` (`@htwang-contrib/loop-guard`).

## What it detects

### Exact-duplicate tool calls ("doom loop")

The classic stuck-agent pattern: `read` the same file, `grep` the same pattern, or retry the same failing `bash` command over and over.

A call only counts toward a loop when **tool + arguments + result are all identical** (results are hashed, including the error flag). This is the "no progress" signal: read-after-edit is safe because the second read returns different content. When the same call has already produced the same result `maxRepeats - 1` times, the next attempt is **blocked** before execution.

### Ping-pong tool calls

Alternating cycles `A,B,A,B,...` (e.g. edit → test → edit → revert) where both A and B return identical results every iteration. Checked *before* exact-repeat so a cycle gets the cycle-specific diagnosis rather than a plain "repeated call" on its third A.

### Thinking repetition (reasoning models)

Reasoning paragraphs (blank-line separated, whitespace-normalized, at least `thinkingMinChunkChars` long) are hashed and compared:

- **within-message** — the same paragraph appears twice in one response (model stuck mid-thought, burning tokens).
- **across-turns** — paragraphs from earlier assistant messages reappear verbatim (model re-deriving the same thoughts each turn).

## What happens on detection

| Detection | Action |
| --- | --- |
| Tool-call loop | Call is blocked; the `reason` becomes the tool result, so the model sees "you are looping, change approach or tell the user" as the tool output. Plus a warning notification. |
| Thinking loop | Warning notification only. Pi cannot block an already-finalized message; consecutive notifications of the same kind are suppressed to avoid spam. |

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
| `notifyOnDetect` | `true` | Show notifications on detection. |

The extension can also be disabled entirely via `isExtensionDisabled("loop-guard")` (see `docs/extension-disable/`).

## Architecture

```
src/
  signatures.ts     stableStringify / sha256 hashing / call summaries
  tool-loop.ts      ToolLoopDetector — pure, options passed per call
  thinking-loop.ts  ThinkingLoopDetector — pure, paragraph hashing
  config.ts         LoopGuardConfig, defaults, ConfigItem registration
  index.ts          wiring: session_start reset, tool_call block, tool_result record, message_end thinking scan
```

Detectors are pure stateful classes with no pi dependencies; `index.ts` is a thin event adapter. State resets on `session_start`.

## Known limitations

- Parallel tool batches: identical calls issued in the same batch all pass `checkCall` before any result is recorded. Loops across turns (the common case) are unaffected.
- A determined 2-cycle can partially evade ping-pong detection after the first block (the blocked call leaves a gap in the alternation). The exact-repeat backstop still catches it as identical results accumulate.
- Near-duplicate detection (fuzzy args like `ls -l` vs `ls -la`) is out of scope; signatures are exact.
- Thinking loops cannot feed back to the model directly (no API to veto a message); user notification is the intervention point.
