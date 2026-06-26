#!/usr/bin/env bash
# worktree-merged.sh
#
# Check whether each git worktree's branch has been merged into a mainline
# branch (master or main, local then remote). Worktrees whose branches are
# merged are safe to delete.
#
# Merge detection covers two cases:
#   1. True merge   - branch tip is reachable from mainline (`git --merged`).
#   2. Squash merge - branch's commits are already in mainline, detected via
#                     patch-id equivalence (`git cherry`). Squash merges are
#                     not reachable, so `--merged` alone would miss them.
#
# Usage:
#   worktree-merged.sh            # report status (dry run)
#   worktree-merged.sh --prune    # remove merged worktrees (asks first)
#
# Flags:
#   --prune             Remove worktrees detected as merged.
#   --mainline <branch> Add a branch or glob pattern (e.g. 'release/*') to the
#                       mainline set (repeatable). Globs expand to local and
#                       remote refs.
#   -y, --yes           Skip confirmation when pruning.
#   -h, --help          Show this help.
#
# Persistent config (optional, set once per repo):
#   git config worktree-merged.mainline develop
#   git config --add  worktree-merged.mainline 'release/*'
# Entries are read at startup and merged with --mainline flags and the
# master/main defaults.

set -euo pipefail

PRUNE=0
ASSUME_YES=0
MAINLINES=()

usage() {
    sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --prune)    PRUNE=1; shift ;;
        --mainline) MAINLINES+=("$2"); shift 2 ;;
        -y|--yes)   ASSUME_YES=1; shift ;;
        -h|--help)  usage ;;
        *) echo "error: unknown option: $1" >&2; exit 2 ;;
    esac
done

# Resolve the git common dir so this works from any worktree.
GIT_DIR=$(git rev-parse --git-common-dir 2>/dev/null) || {
    echo "error: not inside a git repository" >&2
    exit 128
}
GIT_DIR=$(cd "$GIT_DIR" && pwd)
WORKTREE_ROOT=$(cd "$GIT_DIR/.." && pwd)

# Collect mainline entries from three sources, all merged:
#   1. git config worktree-merged.mainline (repeatable via `git config --add`)
#   2. --mainline flags (repeatable)
#   3. hardcoded defaults: master/main, local then remote
CONFIG_MAINLINE_LIST=()
while IFS= read -r line; do
    [[ -n "$line" ]] && CONFIG_MAINLINE_LIST+=("$line")
done < <(git config --get-all worktree-merged.mainline 2>/dev/null || true)

CANDIDATES=("master" "main" "origin/master" "origin/main" "${CONFIG_MAINLINE_LIST[@]:-}" "${MAINLINES[@]}")

# Expand any glob patterns (anything containing * ? [) into concrete refs via
# `git for-each-ref`, matching both local heads and all remotes. Literal names
# pass through untouched. Ref names cannot contain these characters, so the
# glob-vs-literal distinction is unambiguous.
expand_glob() {
    local pat="$1"
    # Match local heads and all remotes; %(refname:short) yields `develop`,
    # `origin/release/1`, etc. - exactly the shape our resolver expects.
    git for-each-ref --format='%(refname:short)' \
        "refs/heads/$pat" "refs/remotes/*/$pat" 2>/dev/null
}

# Build the mainline candidate set. Defaults to master/main (local then remote),
# plus any --mainline additions. Missing branches are dropped after resolution.
MAINLINES=()
for c in "${CANDIDATES[@]}"; do
    [[ -z "$c" ]] && continue
    if [[ "$c" == *[\*\?\[]* ]]; then
        while IFS= read -r expanded; do
            [[ -n "$expanded" ]] && MAINLINES+=("$expanded")
        done < <(expand_glob "$c")
    elif git rev-parse --verify --quiet "$c^{commit}" >/dev/null 2>&1; then
        MAINLINES+=("$c")
    fi
done

if [[ ${#MAINLINES[@]} -eq 0 ]]; then
    echo "error: no mainline branch found (looked for master/main, origin/*)" >&2
    exit 1
fi

# De-duplicate by resolved SHA so remote+local pairs and glob expansions that
# hit the same ref all count once.
dedup_mainlines() {
    declare -A seen
    local out=()
    for m in "${MAINLINES[@]}"; do
        local sha
        sha=$(git rev-parse "$m^{commit}")
        if [[ -z "${seen[$sha]:-}" ]]; then
            seen[$sha]=1
            out+=("$m")
        fi
    done
    printf '%s\n' "${out[@]}"
}
mapfile -t MAINLINES < <(dedup_mainlines)

# Parse `git worktree list --porcelain`. Each worktree is a block of lines
# terminated by a blank line. We care about the `worktree` and `branch` keys.
declare -a WT_PATHS=() WT_BRANCHES=()
current_path=""
while IFS= read -r line; do
    if [[ -z "$line" ]]; then
        current_path=""
        continue
    fi
    case "$line" in
        worktree\ *)
            current_path="${line#worktree }"
            WT_PATHS+=("$current_path")
            WT_BRANCHES+=("")   # placeholder, filled by the branch line
            ;;
        branch\ *)
            # Only the most recent worktree path can carry a branch here.
            local_idx=$((${#WT_PATHS[@]} - 1))
            WT_BRANCHES[$local_idx]="${line#branch refs/heads/}"
            ;;
    esac
done < <(git worktree list --porcelain)

# Branch is a true merge: its tip is reachable from a mainline.
is_ancestor_of_mainline() {
    local tip="$1"
    for m in "${MAINLINES[@]}"; do
        if git merge-base --is-ancestor "$tip" "${m}^{commit}" 2>/dev/null; then
            return 0
        fi
    done
    return 1
}

# Branch's commits are all absorbed by mainline (squash merge), detected by
# patch-id equivalence. `git cherry` outputs `+` (absent) or `-` (present).
# An empty result means the branch tip equals mainline (already counted above).
is_squash_merged_into_mainline() {
    local branch="$1"
    local diff
    diff=$(for m in "${MAINLINES[@]}"; do
        git cherry -v "${m}^{commit}" "$branch" 2>/dev/null || true
    done)
    [[ -n "$diff" ]] || return 0   # no commits differing => absorbed
    # Any line starting with `+` is a commit not found in any mainline.
    if printf '%s\n' "$diff" | grep -q '^+'; then
        return 1
    fi
    return 0
}

status_of() {
    local path="$1" branch="$2"

    # The worktree holding the mainline branch itself, or a detached worktree,
    # is never a candidate for removal.
    if [[ -z "$branch" ]]; then
        echo "detached"; return
    fi
    local m
    for m in "${MAINLINES[@]}"; do
        if [[ "$branch" == "$m" || "$branch" == "${m#origin/}" ]]; then
            echo "mainline"; return
        fi
    done

    local tip
    tip=$(git rev-parse "$branch^{commit}" 2>/dev/null || echo "")
    [[ -n "$tip" ]] || { echo "no-tip"; return; }

    # If the branch tip equals a mainline tip, the branch has not diverged from
    # mainline - it was checked out at mainline's current HEAD but no work has
    # landed via a real or squash merge. Not safe to delete: `merge-base
    # --is-ancestor X X` is true (every commit is its own ancestor), which would
    # otherwise misreport this coincident-tip case as merged.
    local msha
    for m in "${MAINLINES[@]}"; do
        msha=$(git rev-parse "${m}^{commit}")
        if [[ "$tip" == "$msha" ]]; then
            echo "at-mainline"; return
        fi
    done

    if is_ancestor_of_mainline "$tip"; then
        echo "merged"; return
    fi
    if is_squash_merged_into_mainline "$branch"; then
        echo "squash-merged"; return
    fi
    echo "active"
}

# ---- report -------------------------------------------------------------

# Column widths sized to content.
printf '%-2s %-40s %-40s %-14s\n' "" "WORKTREE" "BRANCH" "STATUS"
printf '%-2s %-40s %-40s %-14s\n' "" \
    "$(printf '%0.s-' {1..40})" \
    "$(printf '%0.s-' {1..40})" \
    "$(printf '%0.s-' {1..14})"

removable=()
for i in "${!WT_PATHS[@]}"; do
    path="${WT_PATHS[$i]}"
    branch="${WT_BRANCHES[$i]}"
    status=$(status_of "$path" "$branch")

    # Shorten the branch name column for display only.
    display_branch="$branch"
    [[ -z "$display_branch" ]] && display_branch="(detached)"
    case "$status" in
        merged|squash-merged) mark="X" ;;
        mainline|detached|at-mainline) mark="-" ;;
        *)                    mark=" " ;;
    esac
    printf '%-2s %-40s %-40s %-14s\n' "$mark" "$path" "$display_branch" "$status"

    if [[ "$status" == "merged" || "$status" == "squash-merged" ]]; then
        # Never offer to remove the worktree we are currently sitting in, nor
        # the repo root that owns the mainline.
        if [[ "$path" != "$(pwd)" && "$path" != "$WORKTREE_ROOT" ]]; then
            removable+=("$path")
        fi
    fi
done

echo
echo "Mainlines checked: ${MAINLINES[*]}"
echo "X = merged into mainline, safe to remove (- = mainline/at-mainline/detached, blank = active)"

# ---- prune --------------------------------------------------------------

if [[ $PRUNE -eq 0 ]]; then
    if [[ ${#removable[@]} -gt 0 ]]; then
        echo
        echo "Run with --prune to remove the ${#removable[@]} worktree(s) marked X."
    fi
    exit 0
fi

if [[ ${#removable[@]} -eq 0 ]]; then
    echo "Nothing to prune."
    exit 0
fi

echo
echo "Will remove ${#removable[@]} worktree(s):"
for p in "${removable[@]}"; do printf '  %s\n' "$p"; done
echo

if [[ $ASSUME_YES -eq 0 ]]; then
    read -r -p "Proceed? [y/N] " answer
    case "$answer" in
        y|Y|yes|YES) ;;
        *) echo "aborted"; exit 1 ;;
    esac
fi

for p in "${removable[@]}"; do
    # `git worktree remove` refuses dirty trees by default; --force would discard
    # uncommitted work. We deliberately do NOT force: a failed removal means the
    # branch's tip was merged but the worktree has local changes worth reviewing.
    if git worktree remove "$p"; then
        echo "removed: $p"
    else
        echo "SKIPPED (dirty or locked): $p" >&2
    fi
done
