#!/usr/bin/env python3
"""Write clice.toml from a compile_commands.json that names project sources.

The database rule is always emitted. Translation units under the workspace
that have no entry get a default_command copied from the most common
in-project command of the same extension. Paths inside the project are
rewritten as ${workspace}/...
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
from collections import Counter
from pathlib import Path

INCLUDE_FLAGS = {
    "-I",
    "-isystem",
    "-iquote",
    "-idirafter",
    "-cxx-isystem",
    "-include",
    "-imacros",
}
JOINED_PREFIXES = tuple(sorted(INCLUDE_FLAGS, key=len, reverse=True))
DROP_WITH_VALUE = {"-c", "-o", "-MF", "-MT", "-MQ"}
TU_SUFFIXES = {".c", ".cc", ".cpp", ".cxx"}
SKIP_DIRS = {".git", "node_modules"}


def repo_root(workspace: Path) -> Path | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(workspace), "rev-parse", "--show-toplevel"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    root = out.stdout.strip()
    return Path(root) if root else None


def toml_string(value: str) -> str:
    if "'" not in value:
        return "'" + value + "'"
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return '"' + escaped + '"'


def command_argv(entry: dict) -> list[str]:
    if isinstance(entry.get("arguments"), list) and entry["arguments"]:
        return [str(part) for part in entry["arguments"]]
    command = entry.get("command")
    if not isinstance(command, str) or not command.strip():
        raise SystemExit("compile_commands entry has neither arguments nor command")
    return shlex.split(command)


def abs_path(path: str, directory: Path) -> Path:
    candidate = Path(path)
    if candidate.is_absolute():
        return candidate
    return directory / candidate


def normalize(path: Path) -> Path:
    return Path(os.path.abspath(path))


def strip_compile_only(argv: list[str], source: Path, directory: Path) -> list[str]:
    kept: list[str] = []
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg in DROP_WITH_VALUE:
            index += 2
            continue
        if arg == str(source) or abs_path(arg, directory) == source:
            index += 1
            continue
        kept.append(arg)
        index += 1
    return kept


def split_flag(arg: str, nxt: str | None) -> tuple[str, str | None, int]:
    if arg in INCLUDE_FLAGS or arg in {"-isysroot", "-B"}:
        return arg, nxt, 2
    if arg.startswith("--sysroot="):
        return "--sysroot", arg.split("=", 1)[1], 1
    for prefix in JOINED_PREFIXES:
        if arg.startswith(prefix) and arg != prefix:
            return prefix, arg[len(prefix) :], 1
    return "", None, 1


def workspace_expr(path: Path, workspace: Path, checkout: Path | None) -> str:
    path = normalize(path)
    roots = [workspace]
    if checkout is not None:
        roots.append(checkout)
    for root in roots:
        if path == root or root in path.parents:
            rel = Path(os.path.relpath(path, workspace)).as_posix()
            if rel == ".":
                return "${workspace}"
            return "${workspace}/" + rel
    return str(path)


def rewrite_argv(
    argv: list[str],
    directory: Path,
    workspace: Path,
    checkout: Path | None,
) -> list[str]:
    rewritten: list[str] = []
    index = 0
    while index < len(argv):
        arg = argv[index]
        nxt = argv[index + 1] if index + 1 < len(argv) else None
        flag, value, consumed = split_flag(arg, nxt)
        if flag and value is not None:
            expr = workspace_expr(abs_path(value, directory), workspace, checkout)
            if consumed == 2:
                rewritten.extend([flag, expr])
            elif flag == "--sysroot":
                rewritten.append("--sysroot=" + expr)
            else:
                rewritten.append(flag + expr)
            index += consumed
            continue
        if index == 0 and "/" in arg:
            rewritten.append(workspace_expr(abs_path(arg, directory), workspace, checkout))
        else:
            rewritten.append(arg)
        index += 1
    return rewritten


def collapse_duplicate_defines(argv: list[str]) -> list[str]:
    seen: set[str] = set()
    kept: list[str] = []
    for arg in argv:
        if arg.startswith("-D") and arg in seen:
            continue
        if arg.startswith("-D"):
            seen.add(arg)
        kept.append(arg)
    return kept


def relative_to_workspace(source: Path, workspace: Path) -> str | None:
    try:
        return normalize(source).relative_to(workspace).as_posix()
    except ValueError:
        return None


def workspace_sources(workspace: Path) -> list[str]:
    found: list[str] = []
    for root, dirs, files in os.walk(workspace):
        dirs[:] = [name for name in dirs if name not in SKIP_DIRS and not name.startswith(".")]
        for name in files:
            if Path(name).suffix in TU_SUFFIXES:
                found.append(Path(root, name).relative_to(workspace).as_posix())
    return found


def pattern_for(relative_files: list[str], workspace: Path, claimed: set[str]) -> list[str]:
    by_ext: dict[str, list[str]] = {}
    for rel in relative_files:
        by_ext.setdefault(Path(rel).suffix, []).append(rel)
    patterns: list[str] = []
    for ext, files in sorted(by_ext.items()):
        if not ext:
            patterns.extend(sorted(files))
            continue
        parent = str(Path(files[0]).parent) if len(files) == 1 else os.path.commonpath(files)
        parent_text = "" if parent == "." else Path(parent).as_posix()
        glob = f"{parent_text}/**/*{ext}" if parent_text else f"**/*{ext}"
        matched = {
            path.relative_to(workspace).as_posix()
            for path in workspace.glob(glob)
            if path.is_file()
        }
        owned = set(files)
        if owned <= matched and not (matched & (claimed - owned)):
            patterns.append(glob)
        else:
            patterns.extend(sorted(files))
    return patterns


def emit(workspace: Path, database: Path, rules: list[str]) -> str:
    database_rel = Path(os.path.relpath(database, workspace)).as_posix()
    lines = [
        "#:schema https://docs.clice.io/clice-config.schema.json",
        "",
        "# Generated from compile_commands.json. ${workspace} is this file's directory.",
        "",
        "[[rules]]",
        "compile_commands = [" + toml_string(database_rel) + "]",
        "",
    ]
    lines.extend(rules)
    return "\n".join(lines).rstrip() + "\n"


def build_rules(entries: list[dict], workspace: Path, checkout: Path | None) -> tuple[list[str], str]:
    covered: set[str] = set()
    donors: dict[str, list[tuple[str, ...]]] = {}
    outside = 0
    for entry in entries:
        directory = Path(entry["directory"])
        source = abs_path(str(entry["file"]), directory)
        argv = collapse_duplicate_defines(
            rewrite_argv(
                strip_compile_only(command_argv(entry), source, directory),
                directory,
                workspace,
                checkout,
            )
        )
        rel = relative_to_workspace(source, workspace)
        if rel is None:
            outside += 1
            continue
        covered.add(rel)
        donors.setdefault(source.suffix, []).append(tuple(argv))

    groups: dict[tuple[str, ...], list[str]] = {}
    uncovered = [rel for rel in workspace_sources(workspace) if rel not in covered]
    for rel in uncovered:
        pool = donors.get(Path(rel).suffix)
        if not pool:
            continue
        argv = Counter(pool).most_common(1)[0][0]
        groups.setdefault(argv, []).append(rel)

    rules: list[str] = []
    claimed = {rel for files in groups.values() for rel in files}
    for argv, files in groups.items():
        rules.append("[[rules]]")
        rules.append("patterns = [")
        for pattern in pattern_for(files, workspace, claimed):
            rules.append("  " + toml_string(pattern) + ",")
        rules.append("]")
        rules.append("default_command = [")
        for arg in argv:
            rules.append("  " + toml_string(arg) + ",")
        rules.append("]")
        rules.append("")

    summary = (
        f"entries={len(entries)} in_workspace={len(covered)} "
        f"outside={outside} extra_commands={len(groups)} uncovered={len(uncovered)}"
    )
    return rules, summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    parser.add_argument("--compile-commands", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    workspace = args.workspace.resolve()
    database = (args.compile_commands or workspace / "compile_commands.json").resolve()
    out = (args.out or workspace / "clice.toml").resolve()
    entries = json.loads(database.read_text())
    if not isinstance(entries, list):
        raise SystemExit("compile_commands.json must be an array")

    checkout = repo_root(workspace)
    rules, summary = build_rules(entries, workspace, checkout)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(emit(workspace, database, rules))
    print(f"wrote {out}")
    print(summary)


if __name__ == "__main__":
    sys.exit(main())
