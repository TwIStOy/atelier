export class AsyncAnnotations<T> {
  private values = new Map<string, T>();
  private requested = new Set<string>();
  private controller = new AbortController();
  private onUpdate: () => void;
  private onError: (error: unknown) => void;

  constructor(onUpdate: () => void, onError: (error: unknown) => void) {
    this.onUpdate = onUpdate;
    this.onError = onError;
  }

  get(key: string): T | undefined {
    return this.values.get(key);
  }

  request(key: string, load: (signal: AbortSignal) => Promise<T>, parentSignal?: AbortSignal): void {
    if (this.controller.signal.aborted || parentSignal?.aborted || this.requested.has(key)) return;
    this.requested.add(key);
    const signal = parentSignal ? AbortSignal.any([this.controller.signal, parentSignal]) : this.controller.signal;
    void Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return load(signal);
      })
      .then((value) => {
        if (signal.aborted) return;
        this.values.set(key, value);
        this.onUpdate();
      })
      .catch((error: unknown) => {
        if (!signal.aborted) this.onError(error);
      });
  }

  reset(): void {
    this.dispose();
    this.controller = new AbortController();
  }

  dispose(): void {
    this.controller.abort();
    this.values.clear();
    this.requested.clear();
  }
}
