export type Win32BashToken =
  | { kind: "device" }
  | { kind: "drive-mount"; windowsPath: string }
  | { kind: "posix-absolute" }
  | { kind: "plain" };

const DEVICE_PATHS = new Set(["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr"]);

export function classifyWin32BashToken(token: string): Win32BashToken {
  if (DEVICE_PATHS.has(token)) {
    return { kind: "device" };
  }

  const mount = /^\/([a-zA-Z])(\/.*)?$/.exec(token);
  if (mount) {
    const drive = mount[1]!.toUpperCase();
    const rest = mount[2] ?? "";
    const windowsPath = rest.length === 0 ? `${drive}:\\` : `${drive}:${rest.replaceAll("/", "\\")}`;
    return { kind: "drive-mount", windowsPath };
  }

  if (token.startsWith("/")) {
    return { kind: "posix-absolute" };
  }

  return { kind: "plain" };
}
