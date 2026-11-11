import {
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { QuestionData } from "../../../tool/types.ts";
import type { Clickable } from "../../stateful-view.ts";
import type { OptionListView } from "../option-list-view.ts";
import type { PreviewBlockRenderer } from "./preview-block-renderer.ts";
import {
  bodyWidths,
  columnWidths,
  decideLayout,
  PREVIEW_PADDING_LEFT,
  type PreviewLayoutMode,
  STACKED_GAP_ROWS,
} from "./preview-layout-decider.ts";

// Tests construct `PreviewBlockRenderer` through this facade — keep it stable.
export { PreviewBlockRenderer } from "./preview-block-renderer.ts";

/**
 * Per-tick projection of PreviewPane state. Replaces the prior
 * `setNotesVisible(boolean)` sliver-setter and the sibling reads of
 * `optionListView.getSelectedIndex()` / `isFocused()`. The pane now reads
 * `selectedIndex` and `focused` from its own props — both derived from
 * canonical state via `selectPreviewPaneProps`. `OptionListView` and
 * `PreviewPane` see the same source of truth without the cross-component
 * live read.
 */
export interface PreviewPaneProps {
  notesVisible: boolean;
  selectedIndex: number;
  focused: boolean;
}

export interface PreviewPaneConfig {
  question: QuestionData;
  getTerminalWidth: () => number;
  optionListView: OptionListView;
  previewBlock: PreviewBlockRenderer;
}

/**
 * Thin layout composer. Receives `selectedIndex` / `focused` / `notesVisible`
 * via `setProps` per tick (computed by `selectPreviewPaneProps` from canonical
 * state). Delegates option-side rendering to `OptionListView` (which still
 * owns its render-time state — input buffer, confirmedIndex) and preview-side
 * rendering to `PreviewBlockRenderer` (which owns the markdown cache and
 * bordered-box composition).
 *
 * `naturalHeight` and `maxNaturalHeight` query both children's heights; `render`
 * combines them via `decideLayout` (mode threaded into both calls — never
 * re-derived).
 */
export class PreviewPane implements Clickable<PreviewPaneProps>, Component {
  private readonly question: QuestionData;
  private readonly getTerminalWidth: () => number;
  private readonly optionListView: OptionListView;
  private readonly previewBlock: PreviewBlockRenderer;
  private props: PreviewPaneProps;
  /**
   * Cross-tab max left-width getter. Set exactly once by `buildQuestionnaire.injectGlobalLeftWidth`
   * before any render. Initialized to a throwing sentinel so missing injection is a hard fail
   * rather than a silent fallback to a magic constant — render is illegal until injected.
   */
  private globalLeftWidth: (paneWidth: number) => number = () => {
    throw new Error("PreviewPane.setGlobalLeftWidth must be called before render()");
  };

  constructor(config: PreviewPaneConfig) {
    this.question = config.question;
    this.getTerminalWidth = config.getTerminalWidth;
    this.optionListView = config.optionListView;
    this.previewBlock = config.previewBlock;
    this.props = { notesVisible: false, selectedIndex: 0, focused: false };
  }

  setGlobalLeftWidth(getter: (paneWidth: number) => number): void {
    this.globalLeftWidth = getter;
  }

  private getAdaptiveLeft(paneWidth: number): number {
    return this.globalLeftWidth(paneWidth);
  }

  setProps(props: PreviewPaneProps): void {
    this.props = props;
  }

  handleInput(_data: string): void {}

  /**
   * Forwards clicks that land on the options column to the option list. The preview
   * column, the stacked gap, and everything to the right of the options stay
   * click-through so terminal text selection keeps working there.
   */
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (this.question.multiSelect === true || !this.previewBlock.hasAnyPreview()) {
      return this.optionListView.handleMouse(event);
    }

    const mode = decideLayout(this.getTerminalWidth(), event.width);
    const adaptiveLeft = this.getAdaptiveLeft(event.width);
    const { optionsWidth } = bodyWidths(event.width, mode, adaptiveLeft);

    if (mode === "stacked") {
      if (event.y >= this.optionListView.render(optionsWidth).length) return undefined;
    } else if (event.x >= optionsWidth) {
      return undefined;
    }

    return this.optionListView.handleMouse({ ...event, width: optionsWidth });
  }

  invalidate(): void {
    this.previewBlock.invalidate();
    this.optionListView.invalidate();
  }

  render(width: number): string[] {
    if (this.question.multiSelect === true) return this.optionListView.render(width);
    // Spec: hide the preview pane entirely when no option carries a `preview`.
    if (!this.previewBlock.hasAnyPreview()) return this.optionListView.render(width);

    const mode = decideLayout(this.getTerminalWidth(), width);
    if (mode === "side-by-side") return this.renderSideBySide(width, mode);

    // Stacked: options + blank gap + preview block.
    return [
      ...this.optionListView.render(width),
      ...Array(STACKED_GAP_ROWS).fill(""),
      ...this.previewBlock.renderBlock(
        width,
        this.props.selectedIndex,
        mode,
        this.props.focused,
        this.props.notesVisible,
      ),
    ];
  }

  focusedItemRowRange(width: number): [number, number] {
    if (this.question.multiSelect === true) return this.optionListView.focusedItemRowRange(width);
    if (!this.previewBlock.hasAnyPreview()) return this.optionListView.focusedItemRowRange(width);
    const mode = decideLayout(this.getTerminalWidth(), width);
    if (mode === "stacked") return this.optionListView.focusedItemRowRange(width);
    const adaptiveLeft = this.getAdaptiveLeft(width);
    const { leftWidth } = columnWidths(width, adaptiveLeft);
    return this.optionListView.focusedItemRowRange(leftWidth);
  }

  naturalHeight(width: number): number {
    return this.bodyHeight(width, (previewWidth, mode) =>
      this.previewBlock.blockHeight(previewWidth, this.props.selectedIndex, mode),
    );
  }

  maxNaturalHeight(width: number): number {
    return this.bodyHeight(width, (previewWidth, mode) => {
      let maxPreviewBlock = 0;
      for (let i = 0; i < this.question.options.length; i++) {
        const h = this.previewBlock.blockHeight(previewWidth, i, mode);
        if (h > maxPreviewBlock) maxPreviewBlock = h;
      }
      return maxPreviewBlock;
    });
  }

  private bodyHeight(width: number, previewHeight: (previewWidth: number, mode: PreviewLayoutMode) => number): number {
    if (this.question.multiSelect === true) return this.optionListView.render(width).length;
    if (!this.previewBlock.hasAnyPreview()) return this.optionListView.render(width).length;
    const mode = decideLayout(this.getTerminalWidth(), width);
    const adaptiveLeft = this.getAdaptiveLeft(width);
    const { optionsWidth, previewWidth } = bodyWidths(width, mode, adaptiveLeft);
    const optionsHeight = this.optionListView.render(optionsWidth).length;
    const previewBlockHeight = previewHeight(previewWidth, mode);
    if (mode === "side-by-side") return Math.max(optionsHeight, previewBlockHeight);
    return optionsHeight + STACKED_GAP_ROWS + previewBlockHeight;
  }

  private renderSideBySide(width: number, mode: PreviewLayoutMode): string[] {
    const adaptiveLeft = this.getAdaptiveLeft(width);
    const { leftWidth, rightWidth, gap } = columnWidths(width, adaptiveLeft);
    const leftLines = this.optionListView.render(leftWidth);
    const rightLines = this.renderPaddedPreviewLines(rightWidth, mode);
    const rows = Math.max(leftLines.length, rightLines.length);
    const gapStr = " ".repeat(gap);
    const out: string[] = [];
    for (let i = 0; i < rows; i++) {
      const leftRaw = leftLines[i] ?? "";
      const rightRaw = rightLines[i] ?? "";
      const leftClamped = truncateToWidth(leftRaw, leftWidth, "");
      const leftPad = " ".repeat(Math.max(0, leftWidth - visibleWidth(leftClamped)));
      const joined = `${leftClamped}${leftPad}${gapStr}${rightRaw}`;
      out.push(truncateToWidth(joined, width, ""));
    }
    return out;
  }

  private renderPaddedPreviewLines(colWidth: number, mode: PreviewLayoutMode): string[] {
    const inner = Math.max(1, colWidth - PREVIEW_PADDING_LEFT);
    const contentLines = this.previewBlock.renderBlock(
      inner,
      this.props.selectedIndex,
      mode,
      this.props.focused,
      this.props.notesVisible,
    );
    const boxWidth = Math.max(1, visibleWidth(contentLines[0] ?? ""));
    const paddingLeft = Math.max(PREVIEW_PADDING_LEFT, colWidth - boxWidth);
    const pad = " ".repeat(paddingLeft);
    const available = Math.max(1, colWidth - paddingLeft);
    return contentLines.map((line) => (line === "" ? "" : `${pad}${truncateToWidth(line, available, "")}`));
  }
}
