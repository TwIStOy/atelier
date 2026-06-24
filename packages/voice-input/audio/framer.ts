export const SAMPLE_RATE = 16000;
export const FRAME_SAMPLES = 512;
export const FRAME_BYTES = FRAME_SAMPLES * 2;
export const FRAME_MS = (FRAME_SAMPLES / SAMPLE_RATE) * 1000;

export interface FramerState {
  buffer: Uint8Array;
}

export function createFramerState(): FramerState {
  return { buffer: new Uint8Array(0) };
}

export function s16leBytesToFloat32(bytes: Uint8Array): Float32Array {
  const samples = bytes.length / 2;
  const out = new Float32Array(samples);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < samples; i++) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

export function pushChunk(chunk: Uint8Array, state: FramerState): Float32Array[] {
  const combined = concatBytes(state.buffer, chunk);
  const frameCount = Math.floor(combined.length / FRAME_BYTES);
  const consumed = frameCount * FRAME_BYTES;
  const frames: Float32Array[] = [];
  for (let i = 0; i < frameCount; i++) {
    const start = i * FRAME_BYTES;
    const frameBytes = combined.subarray(start, start + FRAME_BYTES);
    frames.push(s16leBytesToFloat32(frameBytes));
  }
  state.buffer = combined.subarray(consumed);
  return frames;
}

export function remainingBytes(state: FramerState): number {
  return state.buffer.length;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
