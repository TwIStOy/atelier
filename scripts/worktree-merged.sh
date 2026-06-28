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
#   --force             When pruning, pass --force to `git worktree remove`,
#                       discarding uncommitted changes in a dirty worktree
#                       instead of skipping it.
#   --mainline <branch> Add a branch or glob pattern (e.g. 'release/*') to the
#                       mainline set (repeatable). Globs expand to local and
#                       remote refs.
#   --json              Emit machine-readable JSON instead of the human table.
#                       With --prune, removal is non-interactive and results
#                       are included in the output.
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
FORCE=0
ASSUME_YES=0
JSON_OUTPUT=0
MAINLINES=()

usage() {
    sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --prune)    PRUNE=1; shift ;;
        --force)    FORCE=1; shift ;;
        --mainline) MAINLINES+=("$2"); shift 2 ;;
        --json)     JSON_OUTPUT=1; shift ;;
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

# Whether the branch's commits are all absorbed by a single mainline (squash
# merge), detected per-mainline via patch-id equivalence. `git cherry` outputs
# `+` (commit absent from that mainline) or `-` (present).
#
# Evaluated per mainline, not aggregated: a branch is squash-merged if at least
# one mainline contains every one of its commits. Aggregating across mainlines
# would be wrong - a commit present in `origin/master` but not yet in local
# `master` would show a `+` for the latter and mask the match on the former.
is_squash_merged_into_mainline() {
    local branch="$1"
    local diff
    for m in "${MAINLINES[@]}"; do
        diff=$(git cherry -v "${m}^{commit}" "$branch" 2>/dev/null || true)
        # No commits differing from this mainline => tip equals it; already
        # handled by the at-mainline guard in status_of. Treat as not-a-squash
        # here so we don't double-count.
        [[ -n "$diff" ]] || continue
        # If no commit is marked `+`, every commit of the branch is already in
        # this mainline => squash-merged.
        if ! printf '%s\n' "$diff" | grep -q '^+'; then
            return 0
        fi
    done
    return 1
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

# Escape a string for inclusion in a JSON string literal: per RFC 8259 escape
# quote, backslash, and control chars (U+0000..U+001F). Other bytes are passed
# through unchanged so UTF-8 branch names stay intact.
json_escape() {
    local s=$1
    s=${s//\\/\\\\}
    s=${s//\"/\\\"}
    printf '%s' "$s" | LC_ALL=C awk '
        {
            out = ""
            for (i = 1; i <= length($0); i++) {
                c = substr($0, i, 1)
                n = index("\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f", c)
                if (n > 0)
                    out = out sprintf("\\u%04x", n)
                else
                    out = out c
            }
            printf "%s", out
        }'
}

# Print MAINLINES as a JSON array of quoted strings.
join_mainlines() {
    local first=1 m
    printf '['
    for m in "${MAINLINES[@]}"; do
        [[ $first -eq 1 ]] || printf ','
        printf '"%s"' "$(json_escape "$m")"
        first=0
    done
    printf ']'
}

# Emit the whole result as one JSON object on stdout. With --prune, removals
# are performed non-interactively here and their outcomes reported under
# `pruned`. JSON mode is always non-interactive; -y/--yes is implied.
emit_json() {
    local i path branch status removable_flag
    local pruned_paths=() pruned_ok=() pruned_msg=()

    if [[ $PRUNE -eq 1 ]]; then
        local p msg ok
        local remove_args=()
        [[ $FORCE -eq 1 ]] && remove_args+=("--force")
        for p in "${removable[@]}"; do
            msg="" ok=1
            if ! git worktree remove "${remove_args[@]}" "$p" 2>/dev/null; then
                ok=0
                msg="dirty or locked"
            fi
            pruned_paths+=("$p")
            pruned_ok+=("$ok")
            pruned_msg+=("$msg")
        done
    fi

    printf '{"mainlines":%s,"worktrees":[' "$(join_mainlines)"
    for i in "${!RES_PATHS[@]}"; do
        path="${RES_PATHS[$i]}"
        branch="${RES_BRANCHES[$i]}"
        status="${RES_STATUS[$i]}"
        removable_flag="${RES_REMOVABLE[$i]}"
        local branch_json='null'
        [[ -n "$branch" ]] && branch_json="\"$(json_escape "$branch")\""
        [[ $i -gt 0 ]] && printf ','
        printf '{"path":"%s","branch":%s,"status":"%s","removable":%s}' \
            "$(json_escape "$path")" "$branch_json" "$status" "$removable_flag"
    done
    printf ']'

    if [[ $PRUNE -eq 1 ]]; then
        printf ',"pruned":['
        local j
        for j in "${!pruned_paths[@]}"; do
            [[ $j -gt 0 ]] && printf ','
            printf '{"path":"%s","ok":%s' \
                "$(json_escape "${pruned_paths[$j]}")" "${pruned_ok[$j]}"
            if [[ -n "${pruned_msg[$j]}" ]]; then
                printf ',"error":"%s"' "$(json_escape "${pruned_msg[$j]}")"
            fi
            printf '}'
        done
        printf ']'
    fi
    printf '}\n'
}
# ---- collect status ----------------------------------------------------

# Compute status + removability once, into parallel arrays, so the human and
# JSON renderers share identical results.
declare -a RES_PATHS=() RES_BRANCHES=() RES_STATUS=() RES_REMOVABLE=()
for i in "${!WT_PATHS[@]}"; do
    path="${WT_PATHS[$i]}"
    branch="${WT_BRANCHES[$i]}"
    status=$(status_of "$path" "$branch")
    RES_PATHS+=("$path")
    RES_BRANCHES+=("${branch:-}")
    RES_STATUS+=("$status")

    removable=0
    if [[ "$status" == "merged" || "$status" == "squash-merged" ]]; then
        # Never offer to remove the worktree we are currently sitting in, nor
        # the repo root that owns the mainline.
        if [[ "$path" != "$(pwd)" && "$path" != "$WORKTREE_ROOT" ]]; then
            removable=1
        fi
    fi
    RES_REMOVABLE+=("$removable")
done

removable=()
for i in "${!RES_PATHS[@]}"; do
    [[ "${RES_REMOVABLE[$i]}" == "1" ]] && removable+=("${RES_PATHS[$i]}")
done

# ---- render: JSON ------------------------------------------------------

if [[ $JSON_OUTPUT -eq 1 ]]; then
    emit_json
    exit 0
fi

# ---- render: human -----------------------------------------------------

# Column widths sized to content: each is max(header, longest cell), capped
# so an abnormally long path or branch can't blow the table out. The mark and
# gap are fixed; the three data columns are dynamic.
WORKTREE_HDR=WORKTREE
BRANCH_HDR=BRANCH
STATUS_HDR=STATUS
w_path=${#WORKTREE_HDR}
w_branch=${#BRANCH_HDR}
w_status=${#STATUS_HDR}
for i in "${!RES_PATHS[@]}"; do
    p="${RES_PATHS[$i]}"
    b="${RES_BRANCHES[$i]}"
    [[ -z "$b" ]] && b="(detached)"
    (( ${#p} > w_path ))   && w_path=${#p}
    (( ${#b} > w_branch )) && w_branch=${#b}
    s="${RES_STATUS[$i]}"
    (( ${#s} > w_status )) && w_status=${#s}
done
# Cap so a runaway value doesn't widen the whole table without bound.
w_cap=50
(( w_path   > w_cap )) && w_path=$w_cap
(( w_branch > w_cap )) && w_branch=$w_cap

# Build the printf format once from the computed widths.
fmt="%-2s %-${w_path}s %-${w_branch}s %-${w_status}s\n"
rule=$(printf '%0.s-' $(seq 1 "$w_path"))
rule_b=$(printf '%0.s-' $(seq 1 "$w_branch"))
rule_s=$(printf '%0.s-' $(seq 1 "$w_status"))

printf "$fmt" "" "$WORKTREE_HDR" "$BRANCH_HDR" "$STATUS_HDR"
printf "$fmt" "" "$rule" "$rule_b" "$rule_s"

for i in "${!RES_PATHS[@]}"; do
    path="${RES_PATHS[$i]}"
    branch="${RES_BRANCHES[$i]}"
    status="${RES_STATUS[$i]}"
    display_branch="$branch"
    [[ -z "$display_branch" ]] && display_branch="(detached)"
    case "$status" in
        merged|squash-merged) mark="X" ;;
        mainline|detached|at-mainline) mark="-" ;;
        *)                    mark=" " ;;
    esac
    printf "$fmt" "$mark" "$path" "$display_branch" "$status"
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

remove_args=()
[[ $FORCE -eq 1 ]] && remove_args+=("--force")
for p in "${removable[@]}"; do
    # Without --force, `git worktree remove` refuses dirty or locked trees
    # rather than discarding uncommitted work; a failure then means the branch
    # was merged but the worktree had local changes worth reviewing.
    if git worktree remove "${remove_args[@]}" "$p"; then
        echo "removed: $p"
    else
        echo "SKIPPED (dirty or locked): $p" >&2
    fi
done
