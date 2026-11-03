import { DynamicBorder, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Container, type Input, Spacer } from "@earendil-works/pi-tui";
import type { QuestionData } from "../tool/types.ts";
import type { PreviewPaneProps } from "./components/preview/preview-pane.ts";
import type { TabBar } from "./components/tab-bar.ts";
import type { DialogState } from "./dialog-text.ts";
import type { StatefulView } from "./stateful-view.ts";
import type { TabComponents } from "./tab-components.ts";
import { QuestionTabStrategy, SubmitTabStrategy, type TabContentStrategy } from "./tab-content-strategy.ts";

const OVERFLOW_UP = "↑";
const OVERFLOW_DOWN = "↓";
const OVERFLOW_BOTH = "↕";

/** Per-tick projection of dialog state. Written by the adapter; read by the strategy thunk. */
export interface DialogProps {
  state: DialogState;
  activePreviewPane: StatefulView<PreviewPaneProps>;
}

/** Construction-time config for `DialogView`. Frozen after construction. */
export interface DialogConfig {
  theme: Theme;
  questions: readonly QuestionData[];
  tabBar: TabBar | undefined;
  notesInput: Input;
  isMulti: boolean;
  tabsByIndex: ReadonlyArray<TabComponents>;
  /** Optional so single-question mode and non-submit tests can omit it; SubmitTabStrategy falls back to Spacer rows. */
  submitPicker?: Component;
  /** Worst-case body height across all tabs/options. Determines the stable overall dialog footprint. */
  getBodyHeight: (width: number) => number;
  /** Body height of the CURRENTLY active tab/option. The chrome subtracts this from `getBodyHeight` to absorb the residual OUTSIDE the bordered region. */
  getCurrentBodyHeight: (width: number) => number;
  /** Terminal height getter. Mirrors `getTerminalWidth` — reads `tui.terminal.rows` at render time. */
  getTerminalRows: () => number;
}

/** Fixed dialog regions and overflow-window inputs shared by the overflow render helpers. */
interface DialogLayout {
  natural: string[];
  headingCount: number;
  topFixed: number;
  bottomFixed: number;
  middleRows: number;
  availableMiddle: number;
  termRows: number;
}

function addChildren(container: Container, children: readonly Component[]): void {
  for (const c of children) container.addChild(c);
}

function renderWithSpacerRows(natural: string[], spacerRows: number): string[] {
  return spacerRows > 0 ? [...natural, ...Array<string>(spacerRows).fill("")] : natural;
}

function clipToTerminalRows(rows: string[], termRows: number): string[] {
  return rows.length > termRows ? rows.slice(0, termRows) : rows;
}

/**
 * The 7th renderable, promoted from a structural literal to a named class so
 * all view-layer components share one explicit `implements StatefulView<P>`
 * contract. `setProps(DialogProps)` writes the live cell read by the
 * strategy thunk during `render()`. `liveProps.activePreviewPane` is a
 * resolved pane reference threaded by the adapter per tick — the dialog
 * itself does not derive it.
 */
export class DialogView implements StatefulView<DialogProps> {
  private liveProps: DialogProps;
  private readonly config: DialogConfig;
  private readonly questionStrategy: TabContentStrategy;
  private readonly submitStrategy: TabContentStrategy | undefined;
  private readonly maxFooterRowCount: number;

  constructor(config: DialogConfig, initialProps: DialogProps) {
    this.config = config;
    this.liveProps = initialProps;
    this.questionStrategy = new QuestionTabStrategy({
      theme: config.theme,
      questions: config.questions,
      getPreviewPane: () => this.liveProps.activePreviewPane,
      tabsByIndex: config.tabsByIndex,
      notesInput: config.notesInput,
      isMulti: config.isMulti,
      getCurrentBodyHeight: config.getCurrentBodyHeight,
    });
    this.submitStrategy = config.isMulti
      ? new SubmitTabStrategy({
          theme: config.theme,
          questions: config.questions,
          submitPicker: config.submitPicker,
        })
      : undefined;
    this.maxFooterRowCount = Math.max(this.questionStrategy.footerRowCount, this.submitStrategy?.footerRowCount ?? 0);
  }

  setProps(props: DialogProps): void {
    this.liveProps = props;
  }

  handleInput(_data: string): void {}

  // Invalidation is driven by `QuestionnairePropsAdapter.invalidate()`, which
  // owns the full set of renderables (binding registries + extras like
  // `notesInput`). DialogView has no cached layout of its own.
  invalidate(): void {}

  private activeStrategy(state: DialogState): TabContentStrategy {
    const onSubmit = this.config.isMulti && state.currentTab === this.config.questions.length;
    return onSubmit && this.submitStrategy ? this.submitStrategy : this.questionStrategy;
  }

  private topFixedRowCount(): number {
    // TabBar.render() returns [tabLine, ""] — always 2 rows.
    return 1 + (this.config.isMulti && this.config.tabBar ? 2 : 0) + 1;
  }

  render(width: number): string[] {
    const state = this.liveProps.state;
    const strategy = this.activeStrategy(state);

    // Cache heading rows (avoid double construction in render and container build).
    const headingRowCache = strategy.headingRows(state);

    // Build container WITHOUT residual spacer — spacer handled below based on overflow.
    const natural = this.buildContainerFromStrategy(strategy, headingRowCache).render(width);

    // Fixed region sizes (deterministic from structure).
    const topFixed = this.topFixedRowCount();
    const bottomFixed = 1 + strategy.footerRowCount;

    // Residual spacer: equalizes total height across tabs (only needed when no overflow).
    const spacerRows = Math.max(
      0,
      this.config.getBodyHeight(width) +
        this.maxFooterRowCount -
        strategy.bodyHeight(width, state) -
        strategy.footerRowCount,
    );

    const layout: DialogLayout = {
      natural,
      headingCount: headingRowCache.length,
      topFixed,
      bottomFixed,
      middleRows: natural.length - topFixed - bottomFixed,
      availableMiddle: 0,
      termRows: this.config.getTerminalRows(),
    };

    if (natural.length + spacerRows <= layout.termRows) {
      // No overflow — add residual spacer rows after footer.
      return renderWithSpacerRows(natural, spacerRows);
    }

    // OVERFLOW — apply 3-region partition with scroll-to-focus.
    layout.availableMiddle = Math.max(0, layout.termRows - topFixed - bottomFixed);
    if (layout.availableMiddle === 0) {
      return this.renderChromeOnly(layout);
    }
    return this.renderOverflowBody(strategy, state, width, layout);
  }

  // Terminal too small for any middle content — show just chrome.
  private renderChromeOnly(layout: DialogLayout): string[] {
    const chromeOnly = [
      ...layout.natural.slice(0, layout.topFixed),
      ...layout.natural.slice(layout.natural.length - layout.bottomFixed),
    ];
    return clipToTerminalRows(chromeOnly, layout.termRows);
  }

  private renderOverflowBody(
    strategy: TabContentStrategy,
    state: DialogState,
    width: number,
    layout: DialogLayout,
  ): string[] {
    const scrollStart = this.computeScrollStart(strategy, state, width, layout);
    const scrollableMiddle = layout.natural.slice(
      layout.topFixed + scrollStart,
      layout.topFixed + scrollStart + layout.availableMiddle,
    );

    const hasUp = scrollStart > 0;
    const hasDown = scrollStart + layout.availableMiddle < layout.middleRows;
    this.applyOverflowMarkers(scrollableMiddle, hasUp, hasDown);

    const result = [
      ...layout.natural.slice(0, layout.topFixed),
      ...scrollableMiddle,
      ...layout.natural.slice(layout.natural.length - layout.bottomFixed),
    ];
    // Safety: never exceed terminal rows (covers the availableMiddle === 0 case
    // where topFixed + bottomFixed > termRows).
    return clipToTerminalRows(result, layout.termRows);
  }

  // Compute scroll window centered on the focused option.
  private computeScrollStart(
    strategy: TabContentStrategy,
    state: DialogState,
    width: number,
    layout: DialogLayout,
  ): number {
    const bodyRange = strategy.focusedItemRowRange(width, state);
    if (bodyRange) {
      const focusedRowInMiddle = layout.headingCount + bodyRange[0];
      const focusedHeight = bodyRange[1] - bodyRange[0];
      // Center the focused item vertically in the available middle space.
      const idealStart = focusedRowInMiddle - Math.floor(Math.max(0, layout.availableMiddle - focusedHeight) / 2);
      return Math.max(0, Math.min(idealStart, layout.middleRows - layout.availableMiddle));
    }
    // No interactive focus (submit tab) — top-anchor the middle.
    return 0;
  }

  private applyOverflowMarkers(scrollableMiddle: string[], hasUp: boolean, hasDown: boolean): void {
    if (hasUp && hasDown && scrollableMiddle.length === 1) {
      // Single-row middle: combined ↕ avoids the prior collision where ↓ overwrote ↑.
      scrollableMiddle[0] = this.config.theme.fg("dim", OVERFLOW_BOTH);
      return;
    }
    this.markTopScrollEdge(scrollableMiddle, hasUp);
    this.markBottomScrollEdge(scrollableMiddle, hasDown);
  }

  private markTopScrollEdge(scrollableMiddle: string[], hasUp: boolean): void {
    if (hasUp && scrollableMiddle.length > 0) {
      scrollableMiddle[0] = this.config.theme.fg("dim", OVERFLOW_UP);
    }
  }

  private markBottomScrollEdge(scrollableMiddle: string[], hasDown: boolean): void {
    if (hasDown && scrollableMiddle.length > 0) {
      scrollableMiddle[scrollableMiddle.length - 1] = this.config.theme.fg("dim", OVERFLOW_DOWN);
    }
  }

  private buildContainerFromStrategy(strategy: TabContentStrategy, headingRowCache: Component[]): Container {
    const { theme, isMulti, tabBar } = this.config;
    const state = this.liveProps.state;
    const container = new Container();
    const border = () => new DynamicBorder((s) => theme.fg("accent", s));

    container.addChild(border());
    if (isMulti && tabBar) container.addChild(tabBar);
    container.addChild(new Spacer(1));

    addChildren(container, headingRowCache);
    container.addChild(strategy.bodyComponent(state));
    container.addChild(new Spacer(1));
    addChildren(container, strategy.midRows(state));

    container.addChild(border());
    addChildren(container, strategy.footerRows(state));

    // BodyResidualSpacer moved out of Container — handled in render().
    return container;
  }
}
