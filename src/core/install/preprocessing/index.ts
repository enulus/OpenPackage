export { normalizePluginsOption, normalizeInstallOptions } from './options-normalizer.js';
export { classifyInput } from './input-classifier.js';
export { applyBaseDetection, computePathScoping, resolveResourceScoping } from './base-resolver.js';
export type { ResourceScopingResult, ResolveResourceScopingOptions } from './base-resolver.js';
export { resolveConvenienceResources } from './convenience-preprocessor.js';
