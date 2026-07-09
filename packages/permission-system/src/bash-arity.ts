import type { PermissionState } from "./types.ts";

export const ARITY: Record<string, number> = {
  git: 2,
  hg: 2,
  svn: 2,

  npm: 2,
  "npm run": 3,
  "npm exec": 3,
  npx: 2,
  pnpm: 2,
  "pnpm run": 3,
  "pnpm exec": 3,
  "pnpm dlx": 3,
  yarn: 2,
  "yarn run": 3,
  bun: 2,
  "bun run": 3,
  "bun add": 2,
  "bun x": 3,

  deno: 2,
  "deno run": 3,
  "deno task": 3,
  "deno compile": 3,

  pip: 2,
  pip3: 2,
  uv: 2,
  "uv run": 3,
  "uv pip": 3,

  cargo: 2,

  go: 2,
  "go run": 3,

  bundle: 2,
  "bundle exec": 3,

  docker: 2,
  "docker compose": 3,
  "docker container": 3,
  "docker image": 3,
  "docker network": 3,
  "docker volume": 3,
  podman: 2,
  "podman compose": 3,

  kubectl: 2,
  helm: 2,

  aws: 3,
  az: 3,
  gcloud: 3,
  gh: 2,
  "gh pr": 3,
  "gh issue": 3,
  "gh repo": 3,
  fly: 2,
  vercel: 2,
  wrangler: 2,

  make: 1,
  bazel: 2,

  terraform: 2,
  tofu: 2,
  pulumi: 2,

  systemctl: 2,
  service: 2,

  ls: 1,
  ll: 1,
  la: 1,
  cat: 1,
  less: 1,
  more: 1,
  head: 1,
  tail: 1,
  grep: 1,
  rg: 1,
  ag: 1,
  find: 1,
  touch: 1,
  mkdir: 1,
  rm: 1,
  cp: 1,
  mv: 1,
  ln: 1,
  chmod: 1,
  chown: 1,
  du: 1,
  df: 1,
  echo: 1,
  printf: 1,
  diff: 1,
  patch: 1,
  wc: 1,
  sort: 1,
  uniq: 1,
  awk: 1,
  sed: 1,
  tar: 1,
  zip: 1,
  unzip: 1,

  curl: 1,
  wget: 1,
  ssh: 1,
  scp: 1,
  rsync: 1,
  ping: 1,

  kill: 1,
  killall: 1,
  pkill: 1,

  brew: 2,
  apt: 2,
  "apt-get": 2,
  yum: 2,
  dnf: 2,
};

export function prefix(tokens: string[]): string[] {
  if (tokens.length === 0) return [];

  for (let n = tokens.length; n >= 1; n--) {
    const key = tokens
      .slice(0, n)
      .map((t) => t.toLowerCase())
      .join(" ");
    const arity = ARITY[key];
    if (arity !== undefined) {
      return tokens.slice(0, Math.min(arity, tokens.length));
    }
  }

  return [tokens[0]!];
}

export function stripBashCommentLines(command: string): string {
  const lines = command.split("\n");
  const meaningful = lines.filter((line) => !/^\s*#/.test(line));
  return meaningful.join("\n").trim();
}

export type { PermissionState };
