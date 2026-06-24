export function encodeAudioBase64(buffer: Buffer): string {
  return buffer.toString("base64");
}

export type InputAudioFormat = "wav" | "mp3";

export function inferAudioFormat(file: string): InputAudioFormat {
  return file.toLowerCase().endsWith(".mp3") ? "mp3" : "wav";
}
