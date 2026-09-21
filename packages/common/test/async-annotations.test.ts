import { describe, expect, test, vi } from "vitest";
import { AsyncAnnotations } from "../src/async-annotations.ts";

describe("async annotations", () => {
  test("deduplicates requests and leaves synchronous callers unblocked", async () => {
    const update = vi.fn();
    const error = vi.fn();
    const annotations = new AsyncAnnotations<number>(update, error);
    let resolve: (value: number) => void = () => {};
    const load = vi.fn(() => new Promise<number>((done) => (resolve = done)));
    expect(annotations.request("row", load)).toBeUndefined();
    annotations.request("row", load);
    expect(annotations.get("row")).toBeUndefined();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    resolve(7);
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(annotations.get("row")).toBe(7);
    expect(error).not.toHaveBeenCalled();
    annotations.dispose();
  });

  test("discards results from an older generation even when the loader ignores cancellation", async () => {
    const update = vi.fn();
    const annotations = new AsyncAnnotations<number>(update, vi.fn());
    let resolve: (value: number) => void = () => {};
    const load = vi.fn((_signal: AbortSignal) => new Promise<number>((done) => (resolve = done)));
    annotations.request("row", load);
    await vi.waitFor(() => expect(load).toHaveBeenCalled());
    annotations.reset();
    expect(load.mock.calls[0][0].aborted).toBe(true);
    annotations.request("row", async () => 2);
    await vi.waitFor(() => expect(annotations.get("row")).toBe(2));
    resolve(1);
    await new Promise((done) => setImmediate(done));
    expect(annotations.get("row")).toBe(2);
    expect(update).toHaveBeenCalledTimes(1);
    annotations.dispose();
  });

  test("propagates caller cancellation without reporting an assessment failure", async () => {
    const controller = new AbortController();
    const error = vi.fn();
    const update = vi.fn();
    const annotations = new AsyncAnnotations<number>(update, error);
    let receivedSignal: AbortSignal | undefined;
    annotations.request(
      "row",
      (signal) => {
        receivedSignal = signal;
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
      },
      controller.signal,
    );
    await vi.waitFor(() => expect(receivedSignal).toBeDefined());
    controller.abort();
    await new Promise((done) => setImmediate(done));
    expect(receivedSignal?.aborted).toBe(true);
    expect(update).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    annotations.dispose();
  });

  test("catches synchronous loader failures without retrying on repeated renders", async () => {
    const error = vi.fn();
    const annotations = new AsyncAnnotations<number>(vi.fn(), error);
    const load = vi.fn(() => {
      throw new Error("Invalid response");
    });
    annotations.request("row", load);
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    annotations.request("row", load);
    expect(load).toHaveBeenCalledTimes(1);
    annotations.dispose();
  });
});
