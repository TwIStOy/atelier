# child-sessions

Spawning, driving, and settling independent child agent sessions: the shared lifecycle engine behind subagents, the goal verifier, and side-calls.

## Language

**Child session**:
An independent agent session spawned by a parent session, with its own resource loader, session directory, and parent lineage. Not a subagent per se — the subagent is one Driver of it.
_Avoid_: side-call session, verifier session, isolated session

**Driver**:
The caller-supplied callback that owns what a Child session actually does between spawn and Settle: prompting, retry loops, and result Projection. The engine never inspects it.
_Avoid_: runner, executor, handler

**Projection**:
The caller-side conversion of a finished session's messages into a result shape (plain text, structured output, verdict). Belongs to the Driver, never to the engine.
_Avoid_: mapping, serialization

**Settle**:
The engine-owned finish invariant: record session links (with outcome status), unsubscribe observers, and shut the session down — guaranteed to run whether the Driver throws, errors, or succeeds.
_Avoid_: cleanup, teardown
