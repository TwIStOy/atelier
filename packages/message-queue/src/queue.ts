import type { ImageContent } from "@earendil-works/pi-ai";

export interface QueuedMessage {
  text: string;
  images?: ImageContent[];
  queuedAt: number;
}

export class MessageQueue {
  private _items: QueuedMessage[] = [];

  enqueue(text: string, images?: ImageContent[]): void {
    this._items.push({ text, images, queuedAt: Date.now() });
  }

  dequeue(): QueuedMessage | undefined {
    return this._items.shift();
  }

  get isEmpty(): boolean {
    return this._items.length === 0;
  }

  get items(): readonly QueuedMessage[] {
    return this._items;
  }

  clear(): void {
    this._items = [];
  }

  removeAt(index: number): QueuedMessage | undefined {
    if (index < 0 || index >= this._items.length) return undefined;
    return this._items.splice(index, 1)[0];
  }
}
