# Launch a pi agent inside the worktree pane

The full parallel-dev workflow: each module gets its own herdr worktree (one workspace + one git
branch), a pi agent runs in its root pane, and you merge the branches back when done. The hazard
is specific: a big prompt inlined as `pi ... "<task>"` is **silently mangled** by shell quoting, so
`pi` never starts and the pane just sits at a shell prompt.

## PREFERRED — pipe the prompt via stdin

`herdr pane run` types the line + Enter, so an inlined big prompt (nested quotes / backticks / `$`)
gets eaten by shell quoting — the pane ends at a shell prompt and `pi` never runs. **Write the full
task to a file, then pipe it into pi.** pi reads piped stdin and merges it into the initial prompt
(pi README: `cat README.md | pi -p "Summarize…"`), so the prompt is never a shell-interpolated arg:

```bash
# 1. Write the full self-contained task spec to a file (no quoting hazard — it's a file).
cat > /tmp/_task_prompt.txt <<'EOF'
... full task spec, with any quotes/backticks/$ you want ...
EOF

# 2. Pipe it into pi; the CLI arg is a short one-liner, the file is the bulk content.
herdr pane run <pane> 'cat /tmp/_task_prompt.txt | pi --provider <p> --model <m> "Implement the task described in the piped spec."'
```

Caveat: piping stdin consumes EOF, so some shells treat the run as non-interactive and `pi` exits
after its first reply. If you observe the pane drop back to the shell prompt after one turn, either
relaunch with `pi -c` to continue the same session, or fall back to the launcher script below.

## FALLBACK — launcher script with `$(cat file)` substitution

```bash
# /tmp/_launch_pi.sh
#!/usr/bin/env bash
set -euo pipefail
cd <worktree-checkout-path>
exec pi --provider <p> --model <m> "$(cat /tmp/_task_prompt.txt)"
# then: herdr pane run <pane> 'bash /tmp/_launch_pi.sh'
```

`$(cat ...)` is safe here because the file is read at script-run time, not parsed as a quoted CLI
string by the outer shell. Prefer the stdin-pipe method; use this only if the pipe makes pi exit
early. **Model choice matters** — launching N pi agents is N× cost; if the user has not specified a
model/provider, **ask** before spawning.

## Launch sequence

1. `herdr worktree create --workspace "${HERDR_PANE_ID%%:*}" --branch <b> --base master --no-focus --json`
   → parse `result.root_pane.pane_id`, and **verify** `result.workspace.worktree.repo_name` == intended repo.
2. Write the prompt to `/tmp/_task_prompt.txt`.
3. Clear any stuck partial line in the pane: `herdr pane send-keys <pane> C-c` then `C-u`.
4. Launch: `herdr pane run <pane> 'cat /tmp/_task_prompt.txt | pi --provider <p> --model <m> "..."'`
   (fallback: `herdr pane run <pane> 'bash /tmp/_launch_pi.sh'`).
5. **Verify** with `herdr pane process-info --pane <pane>` — foreground process `name` must be `pi`,
   not `fish`/`bash`. If it is the shell, the launch failed; retry with the stdin-pipe method.
   Then `herdr pane read <pane> --lines 20` shows pi's startup banner + tool calls, not echoed text.

## The task prompt

Make it self-contained: the worktree is a full checkout, so point the agent at the repo's plan/spec
+ AGENTS.md rather than pasting huge context. Shape:

> Implement `<module>` of `<project>`. Scope: `<one-liner>`. Read `docs/plan.md` (your section) and
> `AGENTS.md` first. Work only in this worktree on branch `<branch>`. Run `<build/test>`. When done,
> commit.

Tell the agent to maintain whatever progress tracker the project uses (a plan doc's checklist, a
kanban, an ADR log). The implementing agent is the only one that knows exactly which checklist items
its work satisfies — spell it out in the prompt verbatim; do not assume it will tick boxes on its own.
