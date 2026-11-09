export type {
  AgentPersonaCatalog,
  AgentPersonaEntry,
  AgentPersonaFileOptions,
  BuildAgentPersonaCatalogOptions,
} from "./agents/agent-personas.ts";
export {
  buildAgentPersonaCatalog,
  FALLBACK_PERSONA_ID,
  normalizePersonaId,
  personaSystemPrompt,
  personasCatalogXml,
  resolvePersonaId,
  sharedPersonasDir,
} from "./agents/agent-personas.ts";
export type {
  ChildAgentProgress,
  ChildAgentUsageSnapshot,
  EffectiveChildOptions,
  RunChildAgentInput,
  RunChildAgentResult,
} from "./agents/child-agent.ts";
export {
  extractAssistantText,
  finalTurnError,
  parseThinking,
  resolveEffectiveChildOptions,
  runChildAgent,
  STRUCTURED_OUTPUT_TOOL_NAME,
} from "./agents/child-agent.ts";
export {
  CHILD_EXTENSION_FACTORIES_STATE_KEY,
  getChildExtensionFactories,
  registerChildExtensionFactory,
} from "./agents/child-extensions.ts";
export {
  CHILD_DELEGATION_TOOL_NAMES,
  childSessionToolNames,
  resolveChildToolNames,
} from "./agents/child-tools.ts";
export type { IsolatedSessionOptions, IsolatedSessionResult } from "./agents/isolated-session.ts";
export { runIsolatedSession } from "./agents/isolated-session.ts";
export {
  type PersonaTypeDefaults,
  parsePersonaDefaultsByType,
  personaDefaultsFilePath,
  personaDefaultsForType,
  readPersonaDefaultsByType,
} from "./agents/persona-defaults.ts";
export type { ChildSessionLinkRecord } from "./agents/session-links.ts";
export {
  childSessionIndexPath,
  recordChildSessionFinished,
  recordChildSessionStarted,
} from "./agents/session-links.ts";
export { shutdownChildSession } from "./agents/session-shutdown.ts";
export type { SubagentModelConfig, SubagentModelTier } from "./agents/subagent-models.ts";
export {
  loadSubagentModelConfig,
  resolveSubagentModelPattern,
  SUBAGENT_MODEL_TIERS,
} from "./agents/subagent-models.ts";
export type { AggregateRule } from "./aggregate-rules.ts";
export {
  AGGREGATE_RULE_READY_EVENT,
  AGGREGATE_RULE_REGISTER_EVENT,
  aggregateRuleFor,
  registerAggregateRule,
  resetAggregateRulesForTest,
} from "./aggregate-rules.ts";
export { AsyncAnnotations } from "./async-annotations.ts";
export {
  type ClassifierCall,
  type ClassifierRegistry,
  classifierModelOptions,
  createClassifierCall,
  DEFAULT_CLASSIFIER_MODEL,
  parseClassifierRef,
  resolveClassifierModel,
} from "./classifier-models.ts";
export type { ComponentSiblingContext } from "./component-tree.ts";
export {
  componentRenderProbeDepth,
  componentRendersLines,
  findComponentContext,
  findComponentContextInFrame,
} from "./component-tree.ts";
export { mapConcurrent } from "./concurrency.ts";
export type {
  BooleanConfigItem,
  ColorConfigItem,
  ConfigItem,
  ConfigItemBase,
  ConfigItemPreview,
  ConfigItemPreviewContext,
  ConfigItemPreviewHandle,
  ConfigItemRegistry,
  ConfigItemSelectOption,
  ConfigItemType,
  ExtensionConfigSchema,
  LazyOptions,
  MultiSelectConfigItem,
  NumberConfigItem,
  ReorderableConfigItem,
  SelectConfigItem,
  StringConfigItem,
} from "./config/index.ts";
export {
  CONFIG_STAT_TTL_MS,
  clearConfigItems,
  deleteConfigKey,
  deleteConfigSection,
  getConfigEnvVar,
  getConfigFileVersion,
  getConfigItems,
  readConfig,
  readRawConfig,
  registerConfigItems,
  resolveConfigValue,
  setConfigKey,
  updateConfig,
  writeConfig,
} from "./config/index.ts";
export { generateUnifiedDiff } from "./diff.ts";
export {
  chainEditorFactory,
  getEditorFactoryParent,
} from "./editor-chain.ts";
export type {
  AskUserPromptOption,
  AskUserPromptPayload,
  AskUserPromptQuestion,
  EditorHintPayload,
  GoalUpdatePayload,
} from "./events.ts";
export {
  ASK_USER_PROMPT_EVENT,
  EDITOR_HINT_EVENT,
  GOAL_UPDATE_EVENT,
  MODAL_ACTIVE_EVENT,
} from "./events.ts";
export { findExecutable } from "./executable.ts";
export type { DisableConfigPaths } from "./extension-disable.ts";
export {
  defaultDisablePaths,
  isExtensionDisabled,
  resolveDisabledExtensions,
} from "./extension-disable.ts";
export type { PrioritizedSegment, SegmentFitOptions, UsageStressLevel } from "./format.ts";
export {
  fitSegmentsByPriority,
  formatCwd,
  formatElapsedSeconds,
  formatNumber,
  formatProgressBar,
  formatTokens,
  formatTokenUsageArrows,
  formatTokenUsageSummaryLine,
  shortenPath,
  trimTrailingEmpty,
  truncateDisplay,
  usagePercentStressLevel,
} from "./format.ts";
export { currentFrameEpoch, patchTuiFrameEpoch } from "./frame-epoch.ts";
export {
  fetchGatewayModels,
  makeRefreshCommandHandler,
  type RefreshCommandContext,
  refreshModelsCatalog,
} from "./gateway-provider.ts";
export {
  clearGlobalState,
  getGlobalState,
} from "./global-state.ts";
export type { CreateLoggerOptions, Logger, LogLevel } from "./log.ts";
export {
  createLogger,
  getExtensionsLogPath,
  registerLogFileSizeWarning,
  resolveStateDir,
} from "./log.ts";
export type { McpClientInfo, McpSession } from "./mcp.ts";
export { mcpCall, mcpInit } from "./mcp.ts";
export {
  assistantMessageText,
  extractMessageText,
  userMessageText,
} from "./message-text.ts";
export type { ResolvableModel } from "./model-resolve.ts";
export { resolveModel } from "./model-resolve.ts";
export type { RexContext, RexPaneOptions } from "./rex.ts";
export { getLocalRexContext, openRexPane } from "./rex.ts";
export { scrollKeyOffset } from "./scroll-keys.ts";
export type { SessionCache } from "./session-cache.ts";
export {
  branchToMessages,
  createSessionCache,
  isStaleCtxError,
} from "./session-cache.ts";
export { SessionLifecycle } from "./session-lifecycle.ts";
export type { SideCallResult } from "./side-call.ts";
export { executeSideCall } from "./side-call.ts";
export { getAvailableSkillNames } from "./skills.ts";
export type { SpinnerStyle } from "./spinner.ts";
export { DEFAULT_SPINNER, resolveSpinner, SPINNER_STYLES } from "./spinner.ts";
export type {
  KnownSystemPromptContributionId,
  SystemPromptContributeFn,
  SystemPromptContribution,
  SystemPromptContributionMode,
} from "./system-prompt-contributions.ts";
export {
  applySystemPromptContributions,
  clearSystemPromptContributions,
  installSystemPromptAssembler,
  listSystemPromptContributions,
  registerSystemPromptContribution,
  SYSTEM_PROMPT_CONTRIBUTION_PRIORITIES,
  unregisterSystemPromptContribution,
} from "./system-prompt-contributions.ts";
export type {
  TelemetryDeltaType,
  TelemetryFormatOptions,
  TelemetryModelRef,
  TelemetryUsage,
  TurnTelemetry,
} from "./telemetry.ts";
export {
  formatTurnTelemetry,
  TurnTelemetryTracker,
} from "./telemetry.ts";
export {
  extractAnsiRgb,
  fitColWidths,
  makeTable,
  mixAnsiRgb,
  resetForegroundBeforeText,
  terminalWidth,
} from "./terminal.ts";
export { resolveNow } from "./time.ts";
export type {
  RailBar,
  RailMark,
  RailSpec,
  RailStatus,
} from "./tool-rail.ts";
export {
  clearRailTailSpacing,
  isThoughtGroupExpanded,
  isThoughtMember,
  isThoughtMemberClaimed,
  isThoughtTransparent,
  RAIL_BULLET_AGGREGATE,
  RAIL_BULLET_SINGLE,
  RAIL_MARK_GLYPH,
  RAIL_SUBROW_INDENT,
  readRailTailSpacing,
  renderRailLines,
  setRailTailSpacing,
  setThoughtGroupExpanded,
  setThoughtMember,
  setThoughtMemberClaimed,
  setThoughtTransparent,
  TOOL_RAIL_LAYOUT,
  ToolRailComponent,
  toolRailBodyWidth,
} from "./tool-rail.ts";
export { registerTuiCommands } from "./tui-commands.ts";
