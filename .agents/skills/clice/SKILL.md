---
name: clice
description: Configure the clice language server from an in-place compile_commands.json. Use when the user mentions clice, clice.toml, or generating clice rules from a compilation database.
---

# clice

Write `clice.toml` in the directory the editor opens. That directory is the project root. A `clice.toml` in a child directory is a different project and does not apply to the parent's sources.

When `compile_commands.json` names the sources in that directory, one rule is enough:

```toml
#:schema https://docs.clice.io/clice-config.schema.json

[[rules]]
compile_commands = ["compile_commands.json"]
```

`compile_commands` is the database file, or a directory containing one, relative to the config file. Each entry applies to the file it names.

## Generate

Run this when some translation units are not in the database, or when commands should use `${workspace}` instead of absolute paths.

```bash
python3 <skill>/scripts/compile_commands_to_clice.py \
  --workspace <project-root> \
  --compile-commands <compile_commands.json> \
  --out <project-root>/clice.toml
```

`<skill>` is the directory that contains this `SKILL.md`.

The script keeps the database rule. A `.c`, `.cc`, `.cpp`, or `.cxx` file under the project that has no entry gets a `default_command` copied from the most common in-project command of the same extension. Paths inside the project become `${workspace}/...`. The command omits `-c`, `-o`, and the source path.

Match those translation units, not headers. A header without an entry borrows the translation unit that includes it.

## Check

Hover a project header include. Stop when the resolved path is inside the project, the log says `source=Default`, and the toolchain query reports zero failures. Read `clice inspect hover --help` for the binary the user already runs. Pass the source path, `--workspace`, and `--markers` whose point is the byte offset of that include.

Load [references/RULES.md](references/RULES.md) when adding flags, a second command, or turning indexing off.
