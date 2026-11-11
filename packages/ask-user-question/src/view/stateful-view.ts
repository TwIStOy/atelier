import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";

export interface StatefulView<P> extends Component {
  setProps(props: P): void;
}

/**
 * A view that resolves clicks over its own rendered rows and reports them as
 * `PointerTarget`s to the dialog owner. pi dispatches mouse events structurally, so
 * implementing this (rather than just declaring a method) is what marks a view as a
 * click target for the container chain above it.
 */
export interface Clickable<P> extends StatefulView<P> {
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined;
}

export type ActiveView = "notes" | "options" | "submit";
