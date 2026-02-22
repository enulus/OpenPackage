/**
 * @opkg/core - OpenPackage Core Library
 * 
 * Provides all business logic for OpenPackage operations.
 * This package has ZERO terminal/UI dependencies and can be consumed by:
 *   - opkg CLI (terminal UI via @clack/prompts)
 *   - opkg GUI (Tauri desktop app)
 *   - opkg SDK (programmatic usage)
 *   - CI/CD integrations
 * 
 * All user-facing output and prompts are abstracted through
 * OutputPort and PromptPort interfaces.
 */

// ============================================================================
// Port Interfaces (the primary abstraction boundary)
// ============================================================================

export type { OutputPort, UnifiedSpinner } from './core/ports/output.js';
export type { PromptPort, PromptChoice, PromptGroupChoices, TextPromptOptions } from './core/ports/prompt.js';
export { consoleOutput } from './core/ports/console-output.js';
export { nonInteractivePrompt, NonInteractivePromptError } from './core/ports/console-prompt.js';
export { resolveOutput, resolvePrompt } from './core/ports/resolve.js';

// ============================================================================
// Execution Context & Interaction Policy
// ============================================================================

export { createExecutionContext, getContextVariables, getDisplayTargetDir } from './core/execution-context.js';
export {
  createInteractionPolicy,
  PromptTier,
  type InteractionMode,
  type InteractionPolicy,
} from './core/interaction-policy.js';

// ============================================================================
// Install Pipelines
// ============================================================================

export { createOrchestrator } from './core/install/orchestrator/index.js';
export { runUnifiedInstallPipeline } from './core/install/unified/pipeline.js';
export { runMultiContextPipeline } from './core/install/unified/multi-context-pipeline.js';

// ============================================================================
// Uninstall Pipeline
// ============================================================================

export { runUninstallPipeline, runSelectiveUninstallPipeline } from './core/uninstall/uninstall-pipeline.js';
export { executeUninstallCandidate } from './core/uninstall/uninstall-executor.js';
export {
  collectWorkspaceResources,
  buildGroupedUninstallOptions,
  executeBatchUninstall,
  type WorkspaceCollectionResult,
  type GroupedUninstallOptions,
  type UninstallChoiceValue,
  type BatchUninstallSummary,
} from './core/uninstall/workspace-resource-collector.js';
export {
  runDirectUninstallFlow,
  type DirectUninstallOptions,
  type DirectUninstallResult,
  type CandidateFormatters,
} from './core/uninstall/direct-uninstall-flow.js';

// ============================================================================
// Publish / Unpublish Pipelines
// ============================================================================

export { runPublishPipeline } from './core/publish/publish-pipeline.js';
export { runLocalPublishPipeline } from './core/publish/local-publish-pipeline.js';
export { runUnpublishPipeline } from './core/unpublish/unpublish-pipeline.js';
export { runLocalUnpublishPipeline } from './core/unpublish/local-unpublish-pipeline.js';
export {
  runInteractiveUnpublishFlow,
  type InteractiveUnpublishResult,
} from './core/unpublish/interactive-unpublish-flow.js';

// ============================================================================
// Save / Set Pipelines
// ============================================================================

export { runSaveToSourcePipeline } from './core/save/save-to-source-pipeline.js';
export { runSetPipeline } from './core/set/set-pipeline.js';

// ============================================================================
// Add / Remove Pipelines
// ============================================================================

export { runAddToSourcePipeline, runAddToSourcePipelineBatch } from './core/add/add-to-source-pipeline.js';
export {
  processAddResource,
  type AddResourceResult,
  type ProcessAddResourceOptions,
} from './core/add/add-orchestrator.js';
export { runRemoveFromSourcePipeline, runRemoveFromSourcePipelineBatch } from './core/remove/remove-from-source-pipeline.js';

// ============================================================================
// List Pipeline
// ============================================================================

export { runListPipeline } from './core/list/list-pipeline.js';

// ============================================================================
// View Pipeline
// ============================================================================

export {
  resolvePackageView,
  resolveLocalPackage,
  resolveRemoteForPackage,
  type LocalPackageResult,
  type ResolvedViewResult,
  type WorkspaceIndexViewResult,
  type LocalPackageViewResult,
  type RemoteViewResult,
  type NotFoundViewResult,
  type ViewPipelineOptions,
} from './core/view/view-pipeline.js';
export { enhanceResourceGroups } from './core/view/view-helpers.js';

// ============================================================================
// Search Pipeline
// ============================================================================

export {
  runSearchPipeline,
  type SearchOptions,
  type PackageMatch,
  type SearchResult,
} from './core/search/search-pipeline.js';

// ============================================================================
// Package Creation & Context
// ============================================================================

export { createPackage } from './core/package-creation.js';

// ============================================================================
// Types (re-exported from types/)
// ============================================================================

export type {
  ExecutionContext,
  ExecutionOptions,
  ContextVariables,
} from './types/execution-context.js';

export type {
  CommandResult,
  PackageYml,
  Package,
  PackageFile,
  InstallOptions,
  UninstallOptions,
  SaveOptions,
  OpenPackageConfig,
  ProfileConfig,
  Profile,
} from './types/index.js';

export type {
  Platform,
  PlatformDefinition,
} from './types/platform.js';
