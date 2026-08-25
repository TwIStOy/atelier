# Agent–Task Linking

This context defines how tracked work relates to delegated agent execution so that Task state reflects actual execution outcomes.

## Language

**Task**:
A tracked unit of work with a lifecycle of `pending`, `in_progress`, `completed`, or `deleted`. A Task has a Stable Task Identity and may be attempted by more than one Execution Node over time.
_Avoid_: Todo, job, run

**Stable Task Identity**:
The immutable, structure-visible identity of one Task across its lifecycle. It remains distinct when a later Task reuses the same Task Number but is not a user-facing input reference.
_Avoid_: Task Number, display id

**Task Number**:
The short, human-facing `#N` reference used to select a Task within its task list. It may be reused after the list is cleared and therefore cannot identify a delayed execution outcome by itself.
_Avoid_: Stable identity, execution id

**Task Version**:
The branch-local state of a Task with a Stable Task Identity. Versions on branches that diverged before a Link Anchor may evolve and hold Active Claims independently.
_Avoid_: New Task, execution attempt

**Origin Branch**:
The parent session history containing the Link Anchor. A linked outcome belongs to every descendant branch that contains that anchor and to no branch forked before it.
_Avoid_: Current branch, global task list

**Link Anchor**:
The durable point in session history at which a Task Link begins. It defines the causal branch scope of every later linked outcome.
_Avoid_: Current leaf, completion record

**Execution Node**:
One observable aggregate or leaf invocation within an Execution Tree. A single subagent, batch, batch item, workflow, or workflow agent can each be an Execution Node.
_Avoid_: Task, todo, worker

**Execution Attempt**:
One actual run of an Execution Node that may acquire and release an Active Claim. Resuming a Workflow Run creates new Attempts for work that really runs; replaying a cached result does not.
_Avoid_: Workflow Run, cached replay

**Execution Attempt ID**:
The unique identifier shared by one Attempt's admission, Active Claim, cancellation, result, and Attempt Summary. A Workflow Run ID groups Attempts but never replaces their identities.
_Avoid_: Workflow Run ID, Task Number, child session id

**Workflow Run**:
One resumable workflow lineage that may contain multiple Execution Attempts across pauses, failures, and resumes. Every resolved Task Link remains bound to the same Stable Task Identity throughout the Run.
_Avoid_: Execution Attempt, child agent

**Aggregate Execution**:
An Execution Node that coordinates descendant nodes. Its own success follows its orchestration contract rather than being inferred from Task Links in its Execution Tree.
_Avoid_: Parent Task, dependency group

**Batch Execution**:
An Aggregate Execution that succeeds only when every batch item succeeds.
_Avoid_: Workflow Execution

**Workflow Execution**:
An Aggregate Execution that succeeds when its orchestration returns normally. A descendant failure does not by itself make the Workflow Execution fail.
_Avoid_: Batch Execution

**Link Request**:
An explicit request to associate one Execution Node with a Task. It resolves to a Task Link only when the target is eligible as execution starts.
_Avoid_: Task Link, inferred assignment

**Link Rejection**:
The observable outcome of a Link Request that could not resolve to an eligible Task. It is reported to both the parent agent and the user.
_Avoid_: Execution Failure, silent fallback

**Link Fallback**:
The normal response to a Link Rejection: the Execution Node continues as an Unlinked Execution. A Claim Conflict is the exception and prevents the node from running.
_Avoid_: Task Link, silent fallback

**Claim Conflict**:
A Link Rejection caused by another Execution Attempt already holding the Task's Active Claim. It rejects the competing Execution Node before it runs.
_Avoid_: Link Fallback, concurrent claim

**Task Link**:
A resolved association from one Execution Node to one Task on its Origin Branch. The association is never inferred from descriptions, ownership, or current Task state.
_Avoid_: Link Request, implicit assignment, guessed ownership

**Unlinked Execution**:
An Execution Node that runs without a Task Link and therefore cannot change Task state when it finishes.
_Avoid_: Failed execution, linked execution

**Execution Finish**:
The point at which an Execution Node stops running, regardless of whether it succeeded, failed, or was aborted.
_Avoid_: Done, completed

**Technical Success**:
An Attempt that reaches a clean terminal outcome, including an empty clean stop, a soft-limit wrap-up, or a text-producing length stop. Abort, provider/runtime error, hard-limit abort, and missing required structured output are not Technical Success.
_Avoid_: Any finish, semantic proof of task completion

**Execution Success**:
A finished Execution Node with Technical Success and, when linked, a durably settled Task completion. Only Execution Success completes a linked Task.
_Avoid_: Finish, exit, child output alone

**Settlement Failure**:
The outcome when delegated work succeeds but its linked Task completion cannot be durably recorded. The Execution Node is unsuccessful, its output remains available, and the Task stays `in_progress`.
_Avoid_: Execution Success, completed Task

**Execution Failure**:
A finished Execution Node whose outcome failed or was aborted. It releases its Active Claim without completing the linked Task.
_Avoid_: Success, completion

**Active Claim**:
The runtime-bound exclusive association held while an Execution Attempt is running against one Task Version. That version can have at most one Active Claim at a time, and a later Attempt may claim it only after the previous one finishes.
_Avoid_: Task ownership, permanent assignment

**Orphaned Attempt**:
An Execution Attempt left without a terminal outcome because its runtime ended unexpectedly. Its Active Claim is released during recovery while its Task remains `in_progress`.
_Avoid_: Running execution, completed attempt

**Attempt Summary**:
A compact Task-side audit record containing execution identity, kind, label, outcome, and timing without duplicating agent output.
_Avoid_: Agent transcript, Task metadata

**Outcome Notice**:
A once-per-branch context notice that informs the parent agent of a background linked outcome on its next turn without starting that turn.
_Avoid_: Automatic follow-up, repeated reminder

**Task Dependency Graph**:
The explicit `blockedBy` relationships among Tasks. It is independent of the Execution Tree, is never derived from execution parentage, and does not permit deleting a blocker still referenced by a non-deleted Task.
_Avoid_: Execution Tree, implicit child dependency

**Readiness Invariant**:
Every `in_progress` or `completed` Task is a Ready Task. Dependency changes or deletions that would break this condition are rejected.
_Avoid_: Transition-only blocker check

**Ready Task**:
A Task whose every `blockedBy` Task is `completed`. Only a Ready Task may enter or remain in `in_progress` or `completed`.
_Avoid_: Unblocked-looking task, runnable despite blockers

**Owner**:
The person or logical assignee accountable for a Task. Owner is independent of the agent or workflow currently holding an Active Claim.
_Avoid_: Current executor, agent type, workflow label

**Active Task**:
A Task in `in_progress` whose work has started but remains unfinished. It remains active after Execution Failure until it succeeds or is otherwise resolved, and multiple Active Tasks may coexist.
_Avoid_: Currently running execution, global current Task, sole active todo
