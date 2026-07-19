export interface FishUniversalVar {
  name: string;
  values: string[];
  exported: boolean;
  pathvar: boolean;
}

const RECORD_SEPARATOR = "\x1e";
const SETUVAR = "SETUVAR";
const FLAG_PREFIX = "--";

function unescapeValue(input: string): string | null {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c !== "\\") {
      out += c;
      i += 1;
      continue;
    }
    const next = input[i + 1];
    if (next === undefined) {
      return null;
    }
    const simple: Record<string, string> = {
      a: "\x07",
      b: "\x08",
      e: "\x1b",
      f: "\x0c",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\x0b",
    };
    if (simple[next] !== undefined) {
      out += simple[next];
      i += 2;
      continue;
    }
    if (next === "x" || next === "X") {
      const hex = input.slice(i + 2, i + 4);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
        return null;
      }
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 4;
      continue;
    }
    if (next === "u") {
      const hex = input.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
        return null;
      }
      out += String.fromCodePoint(Number.parseInt(hex, 16));
      i += 6;
      continue;
    }
    if (next === "U") {
      const hex = input.slice(i + 2, i + 10);
      if (!/^[0-9a-fA-F]{8}$/.test(hex)) {
        return null;
      }
      out += String.fromCodePoint(Number.parseInt(hex, 16));
      i += 10;
      continue;
    }
    if (next >= "0" && next <= "7") {
      const oct = input.slice(i + 1, i + 4);
      const m = oct.match(/^[0-7]{1,3}/);
      if (!m) {
        return null;
      }
      out += String.fromCharCode(Number.parseInt(m[0], 8) & 0xff);
      i += 1 + m[0].length;
      continue;
    }
    if (next === "c") {
      const ctrl = input[i + 2];
      if (ctrl === undefined) {
        return null;
      }
      const code = ctrl.toLowerCase().charCodeAt(0);
      if (code >= 97 && code <= 122) {
        out += String.fromCharCode(code - 97 + 1);
        i += 3;
        continue;
      }
      const upper = ctrl.toUpperCase().charCodeAt(0);
      if (upper >= 65 && upper <= 90) {
        out += String.fromCharCode(upper - 65 + 1);
        i += 3;
        continue;
      }
      return null;
    }
    out += next;
    i += 2;
  }
  return out;
}

function parseLine(line: string): FishUniversalVar | null {
  const trimmed = line.replace(/^[\t ]+/, "");
  if (trimmed.startsWith("#") || trimmed.length === 0) {
    return null;
  }
  const tokens = trimmed.split(/[\t ]+/).filter((t) => t.length > 0);
  if (tokens.length === 0 || tokens[0] !== SETUVAR) {
    return null;
  }
  let exported = false;
  let pathvar = false;
  let i = 1;
  while (i < tokens.length && tokens[i].startsWith(FLAG_PREFIX)) {
    const flag = tokens[i];
    if (flag === "--export") exported = true;
    else if (flag === "--path") pathvar = true;
    i += 1;
  }
  if (i >= tokens.length) {
    return null;
  }
  const nameAndValue = tokens.slice(i).join(" ");
  const colon = nameAndValue.indexOf(":");
  if (colon === -1) {
    return null;
  }
  const name = nameAndValue.slice(0, colon);
  if (name.length === 0) {
    return null;
  }
  const rawValue = nameAndValue.slice(colon + 1);
  const unescaped = unescapeValue(rawValue);
  if (unescaped === null) {
    return null;
  }
  const values = unescaped.split(RECORD_SEPARATOR);
  return { name, values, exported, pathvar };
}

export function parseFishVariables(content: string): FishUniversalVar[] {
  const lines = content.split("\n");
  const result: FishUniversalVar[] = [];
  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed !== null) {
      result.push(parsed);
    }
  }
  return result;
}
