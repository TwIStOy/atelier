/**
 * Click target resolved from one rendered dialog cell. The view layer maps pointer
 * coordinates to these; `routePointer` (`key-router.ts`) turns them into the same
 * reducer actions the keyboard emits, so pointer and keyboard share one state machine.
 */
export type PointerTarget =
  | { kind: "tab"; index: number }
  | { kind: "submit_tab" }
  | { kind: "option"; index: number }
  | { kind: "submit_choice"; index: 0 | 1 };
