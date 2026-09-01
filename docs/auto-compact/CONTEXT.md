# auto-compact

Extension that manages the context window proactively: compaction checkpoints fire before the context window overflows, and (optionally) after long idle periods when the upstream prompt cache has expired anyway.

## Language

**Compaction checkpoint**:
A hook point where the extension evaluates whether compaction should fire. Four occupancy-based checkpoints exist (pre-turn, mid-turn, emergency, session-resume); idle compaction adds a time-based one.
_Avoid_: trigger point, guard

**Idle compaction**:
Compaction triggered by a time gap since the last session activity rather than by context occupancy. The premise: after a long idle the upstream prompt cache has expired, so the old context would be re-read at full price anyway.
_Avoid_: cache-aware compaction, TTL compaction

**Idle gap**:
Elapsed time between the start of a new turn (or a session resume/fork) and the previous session activity, derived from session entry timestamps — not from in-memory extension state, so it survives reloads and resumes.
_Avoid_: idle time, downtime

**Idle threshold**:
Configurable number of minutes of idle gap beyond which idle compaction may fire. Zero (the default) disables idle compaction entirely.
_Avoid_: idle timeout

**Idle floor**:
The hardcoded minimum context size (50% of the context window) below which idle compaction never fires. Below it, compaction costs more than it saves and needlessly discards fidelity.
_Avoid_: min tokens

**Cache rewarm**:
The full-price re-read of the entire context (plus cache re-write) on the first request after prompt cache TTL expiry. Client code cannot prevent expiry; it can only shrink what gets re-read.
_Avoid_: cache rebuild, cold start

**Emergency truncation**:
The synchronous hard cut of messages (keep-recent / keep-bookends / summarize-all) applied in-flight when the context exceeds the occupancy threshold. Distinct from compaction: no summary is generated first.
_Avoid_: compaction (when meaning the hard cut)
