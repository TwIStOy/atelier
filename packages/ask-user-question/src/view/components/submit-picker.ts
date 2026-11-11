import type { Theme } from "@earendil-works/pi-coding-agent";
import { type TuiMouseEvent, type TuiMouseEventResult, truncateToWidth } from "@earendil-works/pi-tui";
import { dispatchClick } from "@htwang-contrib/common/tui-click";
import type { PointerTarget } from "../../state/pointer-target.ts";
import type { Clickable } from "../stateful-view.ts";

const ACTIVE_POINTER = "❯ ";
const INACTIVE_POINTER = "  ";
const NUMBER_SEPARATOR = ". ";

const SUBMIT_LABEL = "Submit answers";
const CANCEL_LABEL = "Cancel";

/**
 * Per-tick projection of SubmitPicker state. The picker is a fixed 2-row
 * structure (Submit / Cancel) — labels are static, only the active marker
 * varies per tick. `selectSubmitPickerProps` precomputes `active` per row.
 */
export interface SubmitPickerProps {
  /** Per-row active flag. Length always 2: row 0 = Submit, row 1 = Cancel. */
  rows: ReadonlyArray<{ active: boolean }>;
}

/**
 * Static 2-row picker rendered on the Submit Tab. Row 0 = "Submit answers", Row 1 = "Cancel".
 *
 * - Active pointer (❯) follows `props.rows[i].active` per tick.
 * - Both rows render in normal style at all times — D1 (revised) allows partial submission,
 *   so Submit is never dimmed or visually marked as unselectable. The warning header in
 *   `buildSubmitContainer` is the sole signal of incompleteness.
 */
export class SubmitPicker implements Clickable<SubmitPickerProps> {
  private props: SubmitPickerProps;
  private readonly theme: Theme;
  private readonly onPick: (target: PointerTarget) => void;

  constructor(theme: Theme, onPick: (target: PointerTarget) => void) {
    this.theme = theme;
    this.onPick = onPick;
    this.props = { rows: [{ active: false }, { active: false }] };
  }

  setProps(props: SubmitPickerProps): void {
    this.props = props;
  }

  handleInput(_data: string): void {}

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    return dispatchClick(
      event,
      (_x, y) => this.choiceAt(y),
      (index) => this.onPick({ kind: "submit_choice", index }),
    );
  }

  private choiceAt(y: number): 0 | 1 | undefined {
    if (y === 0) return 0;
    if (y === 1) return 1;
    return undefined;
  }

  invalidate(): void {}

  private pickerRowLabel(i: number): string {
    return i === 0 ? SUBMIT_LABEL : CANCEL_LABEL;
  }

  private styledPickerLabel(text: string, active: boolean): string {
    return active ? this.theme.fg("accent", this.theme.bold(text)) : this.theme.fg("text", text);
  }

  private renderPickerRow(i: number, width: number): string {
    const text = this.pickerRowLabel(i);
    const active = this.props.rows[i]?.active ?? false;
    const pointer = active ? ACTIVE_POINTER : INACTIVE_POINTER;
    const number = `${i + 1}${NUMBER_SEPARATOR}`;
    const label = this.styledPickerLabel(text, active);
    return truncateToWidth(`${pointer}${number}${label}`, width, "");
  }

  render(width: number): string[] {
    const lines: string[] = [];
    for (let i = 0; i < 2; i++) {
      lines.push(this.renderPickerRow(i, width));
    }
    return lines;
  }
}
