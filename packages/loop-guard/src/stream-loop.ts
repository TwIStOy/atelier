export interface StreamLoopOptions {
  minWindow: number;
  maxWindow: number;
}

export interface StreamRepeat {
  cleanPrefix: string;
  period: number;
}

function zArray(s: string): Int32Array {
  const n = s.length;
  const z = new Int32Array(n);
  if (n === 0) return z;
  z[0] = n;
  for (let i = 1, l = 0, r = 0; i < n; i++) {
    if (i < r) z[i] = Math.min(r - i, z[i - l]);
    while (i + z[i] < n && s.charCodeAt(z[i]) === s.charCodeAt(i + z[i])) z[i]++;
    if (i + z[i] > r) {
      l = i;
      r = i + z[i];
    }
  }
  return z;
}

export function detectRepeatingSuffix(text: string, options: StreamLoopOptions): StreamRepeat | null {
  const n = text.length;
  const maxWindow = Math.min(options.maxWindow, Math.floor(n / 2));
  if (options.minWindow <= 0 || maxWindow < options.minWindow) return null;
  const tail = text.slice(Math.max(0, n - 2 * maxWindow));
  const z = zArray([...tail].reverse().join(""));
  for (let period = options.minWindow; period <= maxWindow; period++) {
    if (z[period] < period) continue;
    let copies = 2;
    while (
      n - (copies + 1) * period >= 0 &&
      text.slice(n - (copies + 1) * period, n - copies * period) === text.slice(n - period)
    ) {
      copies++;
    }
    return { cleanPrefix: text.slice(0, n - (copies - 1) * period), period };
  }
  return null;
}
