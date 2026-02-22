/**
 * Platform Management Module
 * Centralized platform definitions, directory mappings, and file patterns
 * for all 13 supported AI coding platforms
 * 
 * Now supports flow-based configurations for declarative transformations.
 */

import { join, relative } from "path"
import { exists, ensureDir } from "../utils/fs.js"
import { logger } from "../utils/logger.js"
import { getPathLeaf } from "../utils/path-normalization.js"
import {
  DIR_PATTERNS,
  FILE_PATTERNS,
} from "../constants/index.js"
import { mapPlatformFileToUniversal } from "../utils/platform-mapper.js"
import { parseUniversalPath } from "../utils/platform-file.js"
import { readJsoncFileSync, readJsoncOrJson } from "../utils/jsonc.js"
import * as os from "os"
import type { Flow, SwitchExpression } from "../types/flows.js"
import type { GlobalFlowsConfig } from "../types/platform-flows.js"
import type { Platform, PlatformDefinition, PlatformDetectionResult, PlatformPaths, PlatformDirectoryPaths } from "../types/platform.js"
export type { Platform, PlatformDefinition, PlatformDetectionResult, PlatformPaths, PlatformDirectoryPaths }
import { validateSwitchExpression } from "./flows/switch-resolver.js"
import { 
  matchesAnyPattern, 
  extractSubdirectoriesFromPatterns 
} from "./universal-patterns.js"

// PlatformDefinition is now imported from ../types/platform.js

// Types for JSONC config structure (array format)
interface PlatformConfig {
  name: string
  rootDir?: string  // Optional now, use detection instead
  rootFile?: string  // Optional now, use detection instead
  detection?: string[]  // Array of glob patterns for detection
  export?: Flow[]  // Export flows: Package → Workspace (install, apply)
  import?: Flow[]  // Import flows: Workspace → Package (save)
  aliases?: string[]
  enabled?: boolean
  description?: string
  variables?: Record<string, any>
}

type PlatformsConfig = Record<string, PlatformConfig | GlobalFlowsConfig>

export interface PlatformsState {
  config: PlatformsConfig
  globalExportFlows?: Flow[]  // Global export flows applied to all platforms
  globalImportFlows?: Flow[]  // Global import flows applied to all platforms
  defs: Record<Platform, PlatformDefinition>
  dirLookup: Record<string, Platform>
  aliasLookup: Record<string, Platform>
  universalPatterns: Set<string>  // All 'from' patterns from export flows (source of truth)
  universalSubdirs: Set<string>  // Derived from patterns for backward compatibility
  rootFiles: string[]
  allPlatforms: Platform[]
  enabledPlatforms: Platform[]
}

/**
 * Check if a config entry is a global flows config
 */
function isGlobalFlowsConfig(cfg: PlatformConfig | GlobalFlowsConfig): cfg is GlobalFlowsConfig {
  return ('export' in cfg || 'import' in cfg) && !('name' in cfg) && !('rootDir' in cfg)
}

/**
 * Create platform definitions from a PlatformsConfig object
 * Export/import flows configuration (no legacy subdirs support)
 * Assumes config is already validated.
 * @param config - The merged platforms configuration
 */
function createPlatformDefinitions(
  config: PlatformsConfig
): Record<Platform, PlatformDefinition> {
  const result: Record<Platform, PlatformDefinition> = {}

  for (const [id, cfg] of Object.entries(config)) {
    // Skip special keys
    if (id === '$schema') continue
    
    // Skip global config entry
    if (id === 'global') continue
    
    // Type guard for platform config
    if (isGlobalFlowsConfig(cfg)) continue
    
    // Now we know cfg is PlatformConfig
    const platformConfig = cfg as PlatformConfig
    const platformId = id as Platform

    result[platformId] = {
      id: platformId,
      name: platformConfig.name,
      rootDir: platformConfig.rootDir,
      rootFile: platformConfig.rootFile,
      detection: platformConfig.detection,
      export: platformConfig.export || [],
      import: platformConfig.import || [],
      aliases: platformConfig.aliases,
      enabled: platformConfig.enabled !== false,
      description: platformConfig.description,
      variables: platformConfig.variables,
    }
  }

  return result
}

const BUILT_IN_CONFIG: PlatformsConfig =
  readJsoncFileSync<PlatformsConfig>("platforms.jsonc")

const builtinErrors = validatePlatformsConfig(BUILT_IN_CONFIG)
if (builtinErrors.length > 0) {
  throw new Error(`Built-in platforms.jsonc validation failed:\n  - ${builtinErrors.join('\n  - ')}`)
}

/**
 * Merge two PlatformsConfig objects, handling per-platform fields and subdirs arrays properly.
 * Adds new platforms from override; merges existing with override preferences.
 */
export function mergePlatformsConfig(base: PlatformsConfig, override: PlatformsConfig): PlatformsConfig {
  const merged: PlatformsConfig = { ...base }

  for (const [platformId, overridePlat] of Object.entries(override)) {
    // Skip special keys
    if (platformId === '$schema') {
      merged[platformId] = overridePlat
      continue
    }

    const basePlat = base[platformId]
    if (!basePlat) {
      merged[platformId] = overridePlat
      continue
    }

    // Handle global config separately
    if (platformId === 'global') {
      if (isGlobalFlowsConfig(overridePlat)) {
        merged[platformId] = overridePlat  // Replace global config entirely
      }
      continue
    }

    // Type guard for platform config
    if (isGlobalFlowsConfig(overridePlat) || isGlobalFlowsConfig(basePlat)) {
      merged[platformId] = overridePlat
      continue
    }

    // Now we know both are PlatformConfig
    const overrideCfg = overridePlat as PlatformConfig
    const baseCfg = basePlat as PlatformConfig

    merged[platformId] = {
      name: overrideCfg.name ?? baseCfg.name,
      rootDir: overrideCfg.rootDir ?? baseCfg.rootDir,
      rootFile: overrideCfg.rootFile ?? baseCfg.rootFile,
      detection: overrideCfg.detection ?? baseCfg.detection, // replace array
      aliases: overrideCfg.aliases ?? baseCfg.aliases, // replace array
      enabled: overrideCfg.enabled ?? baseCfg.enabled,
      description: overrideCfg.description ?? baseCfg.description,
      variables: overrideCfg.variables ?? baseCfg.variables,
      export: overrideCfg.export ?? baseCfg.export, // replace array (no merge)
      import: overrideCfg.import ?? baseCfg.import, // replace array (no merge)
    }
  }

  return merged
}

/**
 * Validate a PlatformsConfig object and return any validation errors.
 * Export/import flows configuration (no legacy subdirs support).
 * @param config - The config to validate
 * @returns Array of error messages; empty if valid
 */
export function validatePlatformsConfig(config: PlatformsConfig): string[] {
  const errors: string[] = []

  for (const [platformId, platConfig] of Object.entries(config)) {
    // Skip special keys
    if (platformId === '$schema') {
      continue
    }

    // Skip global config - validate separately
    if (platformId === 'global') {
      if (isGlobalFlowsConfig(platConfig)) {
        errors.push(...validateGlobalFlowsConfig(platConfig))
      }
      continue
    }

    // Type guard for platform config
    if (isGlobalFlowsConfig(platConfig)) {
      errors.push(`Platform '${platformId}': Cannot use global flows config format for platform entry`)
      continue
    }

    // Now we know platConfig is PlatformConfig
    const cfg = platConfig as PlatformConfig

    // rootDir is now optional if detection is provided
    if (!cfg.detection && (!cfg.rootDir || cfg.rootDir.trim() === '')) {
      errors.push(`Platform '${platformId}': Must define either 'detection' array or 'rootDir'`)
    }
    if (!cfg.name || cfg.name.trim() === '') {
      errors.push(`Platform '${platformId}': Missing or empty name`)
    }

    // Validate export flows
    if (cfg.export !== undefined) {
      if (!Array.isArray(cfg.export)) {
        errors.push(`Platform '${platformId}': export must be array or undefined`)
      } else {
        errors.push(...validateFlows(cfg.export, `${platformId}.export`))
      }
    }

    // Validate import flows
    if (cfg.import !== undefined) {
      if (!Array.isArray(cfg.import)) {
        errors.push(`Platform '${platformId}': import must be array or undefined`)
      } else {
        errors.push(...validateFlows(cfg.import, `${platformId}.import`))
      }
    }

    // Validate that export or import or rootFile or detection is present
    const hasExport = cfg.export && cfg.export.length > 0;
    const hasImport = cfg.import && cfg.import.length > 0;
    const hasDetection = cfg.detection && cfg.detection.length > 0;
    if (!hasExport && !hasImport && !cfg.rootFile && !hasDetection) {
      errors.push(`Platform '${platformId}': Must define at least one of 'export', 'import', 'detection', or 'rootFile'`)
    }

    if (cfg.aliases !== undefined && (!Array.isArray(cfg.aliases) || cfg.aliases.some((a: any) => typeof a !== 'string'))) {
      errors.push(`Platform '${platformId}': aliases must be array of strings or undefined`)
    }
    if (typeof cfg.enabled !== 'boolean' && cfg.enabled !== undefined) {
      errors.push(`Platform '${platformId}': enabled must be boolean or undefined`)
    }
    if (cfg.variables !== undefined && (typeof cfg.variables !== 'object' || Array.isArray(cfg.variables))) {
      errors.push(`Platform '${platformId}': variables must be object or undefined`)
    }
  }

  return errors
}

/**
 * Extract pattern string from flow field (handles string, array, and pattern object)
 */
function extractPatternString(field: any): string | null {
  if (typeof field === 'string') {
    return field;
  }
  if (typeof field === 'object' && field !== null) {
    if ('pattern' in field) {
      return field.pattern;
    }
    if ('$switch' in field) {
      return null; // Skip switch expressions
    }
  }
  if (Array.isArray(field) && field.length > 0) {
    return extractPatternString(field[0]);
  }
  return null;
}

/**
 * Validate global flows configuration
 */
function validateGlobalFlowsConfig(config: GlobalFlowsConfig): string[] {
  const errors: string[] = []
  
  if (config.export !== undefined) {
    if (!Array.isArray(config.export)) {
      errors.push(`Global config: export must be array or undefined`)
    } else {
      errors.push(...validateFlows(config.export, 'global.export'))
    }
  }
  
  if (config.import !== undefined) {
    if (!Array.isArray(config.import)) {
      errors.push(`Global config: import must be array or undefined`)
    } else {
      errors.push(...validateFlows(config.import, 'global.import'))
    }
  }
  
  if (config.description !== undefined && typeof config.description !== 'string') {
    errors.push(`Global config: description must be string or undefined`)
  }
  
  return errors
}

/**
 * Validate an array of flows
 */
/**
 * Check if a value is a switch expression
 */
function isSwitchExpression(value: any): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$switch' in value
  );
}

/**
 * Check if a value is a pattern object (with pattern and optional schema)
 */
function isPatternObject(value: any): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'pattern' in value &&
    typeof value.pattern === 'string'
  );
}

/**
 * Validate a pattern object
 */
function validatePatternObject(value: any, context: string): string[] {
  const errors: string[] = [];
  
  if (typeof value.pattern !== 'string' || value.pattern.trim() === '') {
    errors.push(`${context}: pattern must be non-empty string`);
  }
  
  if ('schema' in value && typeof value.schema !== 'string') {
    errors.push(`${context}: schema must be string if provided`);
  }
  
  return errors;
}

function validateFlows(flows: Flow[], context: string): string[] {
  const errors: string[] = []
  
  for (let i = 0; i < flows.length; i++) {
    const flow = flows[i]
    
    // Required fields
    if (!flow.from) {
      errors.push(`${context}, flows[${i}]: Missing 'from' field`)
    } else if (typeof flow.from === 'string') {
      if (flow.from.trim() === '') {
        errors.push(`${context}, flows[${i}]: 'from' cannot be empty`)
      }
    } else if (Array.isArray(flow.from)) {
      if (flow.from.length === 0) {
        errors.push(`${context}, flows[${i}]: 'from' array cannot be empty`)
      }
      flow.from.forEach((p, j) => {
        if (typeof p === 'string') {
          if (p.trim() === '') {
            errors.push(`${context}, flows[${i}]: 'from' array item ${j} cannot be empty string`)
          }
        } else if (isPatternObject(p)) {
          errors.push(...validatePatternObject(p, `${context}, flows[${i}].from[${j}]`))
        } else {
          errors.push(`${context}, flows[${i}]: 'from' array item ${j} must be string or pattern object`)
        }
      })
    } else if (isSwitchExpression(flow.from)) {
      // Switch expression validation happens elsewhere
    } else if (isPatternObject(flow.from)) {
      errors.push(...validatePatternObject(flow.from, `${context}, flows[${i}].from`))
    } else {
      errors.push(`${context}, flows[${i}]: 'from' must be string, array, pattern object, or $switch expression`)
    }
    
    if (!flow.to) {
      errors.push(`${context}, flows[${i}]: Missing 'to' field`)
    } else if (typeof flow.to === 'string') {
      if (flow.to.trim() === '') {
        errors.push(`${context}, flows[${i}]: 'to' cannot be empty`)
      }
    } else if (isSwitchExpression(flow.to)) {
      // Validate switch expression structure
      const switchValidation = validateSwitchExpression(flow.to as any);
      if (!switchValidation.valid) {
        switchValidation.errors.forEach(err => {
          errors.push(`${context}, flows[${i}]: ${err}`);
        });
      }
    } else if (isPatternObject(flow.to)) {
      errors.push(...validatePatternObject(flow.to, `${context}, flows[${i}].to`))
    } else if (typeof flow.to === 'object') {
      // Multi-target flows - validate each target
      for (const [targetPath, targetFlow] of Object.entries(flow.to)) {
        if (typeof targetPath !== 'string' || targetPath.trim() === '') {
          errors.push(`${context}, flows[${i}].to: target path cannot be empty`)
        }
      }
    } else {
      errors.push(`${context}, flows[${i}]: 'to' must be string, pattern object, switch expression, or multi-target object`)
    }
    
    // Validate merge strategy
    if (flow.merge !== undefined) {
      const validMerges = ['replace', 'shallow', 'deep', 'composite']
      if (!validMerges.includes(flow.merge)) {
        errors.push(`${context}, flows[${i}]: Invalid merge strategy '${flow.merge}'. Must be one of: ${validMerges.join(', ')}`)
      }
    }
    
    // Validate legacy 'pipe' (still supported in platforms.jsonc for compatibility)
    const pipe = (flow as any).pipe
    if (pipe !== undefined) {
      if (!Array.isArray(pipe)) {
        errors.push(`${context}, flows[${i}]: 'pipe' must be array`)
      } else if (pipe.some((p: any) => typeof p !== 'string' || p.trim() === '')) {
        errors.push(`${context}, flows[${i}]: 'pipe' must be array of strings`)
      }
    }
    
    // Validate map pipeline (must be array)
    if (flow.map !== undefined && !Array.isArray(flow.map)) {
      errors.push(`${context}, flows[${i}]: 'map' must be array of operations`)
    }
    
    // Validate pick/omit
    if (flow.pick !== undefined && !Array.isArray(flow.pick)) {
      errors.push(`${context}, flows[${i}]: 'pick' must be array or undefined`)
    }
    if (flow.omit !== undefined && !Array.isArray(flow.omit)) {
      errors.push(`${context}, flows[${i}]: 'omit' must be array or undefined`)
    }
    
    // Validate embed
    if (flow.embed !== undefined && (typeof flow.embed !== 'string' || flow.embed.trim() === '')) {
      errors.push(`${context}, flows[${i}]: 'embed' must be non-empty string or undefined`)
    }
  }
  
  return errors
}

const GLOBAL_DIR = join(os.homedir(), ".openpackage")

const stateCache = new Map<string | null, PlatformsState>()

/**
 * Clear the platforms cache. Useful for testing.
 * @param cwd Optional path to clear cache for. If not provided, clears all cache.
 */
export function clearPlatformsCache(targetDir?: string): void {
  if (targetDir !== undefined) {
    stateCache.delete(targetDir)
  } else {
    stateCache.clear()
  }
}

export function getPlatformsState(targetDir?: string | null): PlatformsState {
  const key = targetDir ?? null
  if (stateCache.has(key)) {
    return stateCache.get(key)!
  }

  let config: PlatformsConfig

  if (key === null) {
    // Global
    const globalFile =
      readJsoncOrJson(join(GLOBAL_DIR, "platforms.jsonc")) ??
      readJsoncOrJson(join(GLOBAL_DIR, "platforms.json")) as PlatformsConfig | undefined
    config = globalFile
      ? mergePlatformsConfig(BUILT_IN_CONFIG, globalFile)
      : BUILT_IN_CONFIG

    const errors = validatePlatformsConfig(config)
    if (errors.length > 0) {
      throw new Error(`Global platforms config validation failed:\n  - ${errors.join('\n  - ')}`)
    }
  } else {
    // Local
    const globalState = getPlatformsState(null)
    const globalConfig = globalState.config

    const localDir = join(key, DIR_PATTERNS.OPENPACKAGE)
    const localFile =
      readJsoncOrJson(join(localDir, "platforms.jsonc")) ??
      readJsoncOrJson(join(localDir, "platforms.json")) as PlatformsConfig | undefined
    config = localFile
      ? mergePlatformsConfig(globalConfig, localFile)
      : globalConfig

    const errors = validatePlatformsConfig(config)
    if (errors.length > 0) {
      throw new Error(`Local platforms config validation failed in ${key}:\n  - ${errors.join('\n  - ')}`)
    }
  }

  // Extract global flows if present
  const globalConfig = config['global']
  const globalExportFlows = (globalConfig && isGlobalFlowsConfig(globalConfig)) 
    ? globalConfig.export 
    : undefined
  const globalImportFlows = (globalConfig && isGlobalFlowsConfig(globalConfig)) 
    ? globalConfig.import 
    : undefined

  // Create definitions and compute state
  const defs = createPlatformDefinitions(config)

  const dirLookup: Record<string, Platform> = {}
  const aliasLookup: Record<string, Platform> = {}
  const universalPatterns = new Set<string>()
  const rootFiles: string[] = []
  const allPlatforms: Platform[] = []

  // Collect all universal patterns from platform export flows
  for (const def of Object.values(defs)) {
    allPlatforms.push(def.id)
    if (def.rootDir) {
      dirLookup[def.rootDir] = def.id
    }
    for (const alias of def.aliases ?? []) {
      aliasLookup[alias.toLowerCase()] = def.id
    }
    
    // Collect all 'from' patterns from export flows
    if (def.export && def.export.length > 0) {
      for (const flow of def.export) {
        // Extract pattern string using helper
        const pattern = extractPatternString(flow.from);
        if (pattern) {
          universalPatterns.add(pattern);
        }
      }
    }
    
    if (def.rootFile) {
      rootFiles.push(def.rootFile)
    }
  }

  // Add patterns from global export flows
  if (globalExportFlows && globalExportFlows.length > 0) {
    for (const flow of globalExportFlows) {
      // Extract pattern string using helper
      const pattern = extractPatternString(flow.from);
      if (pattern) {
        universalPatterns.add(pattern);
      }
    }
  }

  // Derive subdirectories from patterns (backward compatibility)
  const universalSubdirs = extractSubdirectoriesFromPatterns(universalPatterns)

  const enabledPlatforms = allPlatforms.filter((p: string) => defs[p].enabled)

  const state: PlatformsState = {
    config,
    globalExportFlows,
    globalImportFlows,
    defs,
    dirLookup,
    aliasLookup,
    universalPatterns,
    universalSubdirs,
    rootFiles,
    allPlatforms,
    enabledPlatforms
  }

  stateCache.set(key, state)
  return state
}

export function getPlatformDefinitions(
  targetDir?: string
): Record<Platform, PlatformDefinition> {
  return getPlatformsState(targetDir).defs
}

/**
 * Get global export flows that apply to all platforms (install/apply)
 */
export function getGlobalExportFlows(targetDir?: string): Flow[] | undefined {
  return getPlatformsState(targetDir).globalExportFlows
}

/**
 * Get global import flows that apply to all platforms (save)
 */
export function getGlobalImportFlows(targetDir?: string): Flow[] | undefined {
  return getPlatformsState(targetDir).globalImportFlows
}

/**
 * Check if a platform uses flow-based configuration (export or import)
 */
export function platformUsesFlows(platform: Platform, targetDir?: string): boolean {
  try {
    const def = getPlatformDefinition(platform, targetDir)
    const hasExport = def.export !== undefined && def.export.length > 0
    const hasImport = def.import !== undefined && def.import.length > 0
    return hasExport || hasImport
  } catch (error) {
    // Platform not found - return false
    return false
  }
}

/**
 * Get all universal path patterns from flow definitions.
 * These patterns define which files are considered universal package content.
 * This is the source of truth for determining what belongs in a package.
 * 
 * @param targetDir - Optional target directory for local config overrides
 * @returns Set of glob patterns from all platform flows
 * 
 * @example
 * // Returns: Set(["rules/**\/*.md", "mcp.jsonc", "commands/*.md", ...])
 * const patterns = getAllUniversalPatterns()
 */
export function getAllUniversalPatterns(targetDir?: string): Set<string> {
  return new Set(getPlatformsState(targetDir).universalPatterns)
}

/**
 * Check if a file path matches any universal pattern from flows.
 * This is the primary method for determining if a file is universal content.
 * 
 * @param filePath - File path to check (normalized, no leading slash)
 * @param targetDir - Optional target directory for local config overrides
 * @returns true if path matches any universal pattern
 * 
 * @example
 * matchesUniversalPattern("mcp.jsonc") // true (if defined in flows)
 * matchesUniversalPattern("rules/typescript.md") // true
 * matchesUniversalPattern("random-file.txt") // false
 */
export function matchesUniversalPattern(filePath: string, targetDir?: string): boolean {
  const patterns = getAllUniversalPatterns(targetDir)
  return matchesAnyPattern(filePath, patterns)
}

/**
 * Get lookup map from platform directory name to platform ID.
 */
export function getPlatformDirLookup(targetDir?: string): Record<string, Platform> {
  return getPlatformsState(targetDir).dirLookup
}

/**
 * Get lookup map from platform alias to platform ID.
 */
export function getPlatformAliasLookup(targetDir?: string): Record<string, Platform> {
  return getPlatformsState(targetDir).aliasLookup
}

/**
 * Get all known platform root files.
 */
export function getPlatformRootFiles(targetDir?: string): string[] {
  return getPlatformsState(targetDir).rootFiles
}



// PlatformDetectionResult, PlatformPaths, PlatformDirectoryPaths are now imported from ../types/platform.js

/**
 * Get platform definition by name
 * @throws Error if platform not found
 */
export function getPlatformDefinition(
  name: Platform,
  targetDir?: string
): PlatformDefinition {
  const state = getPlatformsState(targetDir)
  const def = state.defs[name]
  if (!def) {
    throw new Error(`Unknown platform: ${name}`)
  }
  return def
}

/**
 * Derive the root directory from platform flows.
 * Extracts the common root directory from export flow 'to' patterns.
 * Falls back to platform ID if no flows defined.
 * 
 * @param definition - Platform definition
 * @returns Root directory path (e.g., '.claude', '.cursor')
 */
export function deriveRootDirFromFlows(definition: PlatformDefinition): string {
  // If rootDir is explicitly defined, use it
  if (definition.rootDir) {
    return definition.rootDir;
  }
  
  // Helper to extract path from switch expression (uses default if available)
  const extractPathFromSwitch = (switchExpr: any): string | null => {
    if (isSwitchExpression(switchExpr)) {
      // Use default if available, otherwise first case value
      return switchExpr.$switch.default || (switchExpr.$switch.cases[0]?.value);
    }
    return null;
  };
  
  // Try to extract from export flows
  if (definition.export && definition.export.length > 0) {
    for (const flow of definition.export) {
      let toPattern: string | null = null;
      
      if (typeof flow.to === 'string') {
        toPattern = flow.to;
      } else if (isSwitchExpression(flow.to)) {
        toPattern = extractPathFromSwitch(flow.to);
      } else {
        toPattern = Object.keys(flow.to)[0];
      }
      
      if (toPattern) {
        // Extract root directory from pattern (e.g., ".claude/rules/**/*.md" -> ".claude")
        const match = toPattern.match(/^(\.[^/]+)/);
        if (match) {
          return match[1];
        }
      }
    }
  }
  
  // Try to extract from import flows
  if (definition.import && definition.import.length > 0) {
    for (const flow of definition.import) {
      let fromPattern: string | null = null;
      
      if (typeof flow.from === 'string') {
        fromPattern = flow.from;
      } else if (Array.isArray(flow.from)) {
        fromPattern = flow.from[0];
      } else if (isSwitchExpression(flow.from)) {
        fromPattern = extractPathFromSwitch(flow.from);
      }
      
      if (fromPattern) {
        // Extract root directory from pattern
        const match = fromPattern.match(/^(\.[^/]+)/);
        if (match) {
          return match[1];
        }
      }
    }
  }
  
  // Fallback to platform ID prefixed with dot
  return `.${definition.id}`;
}

/**
 * Get all platforms
 */
export function getAllPlatforms(
  options?: { includeDisabled?: boolean },
  targetDir?: string
): Platform[] {
  const state = getPlatformsState(targetDir)
  if (options?.includeDisabled) {
    return state.allPlatforms
  }
  return state.enabledPlatforms
}

export function resolvePlatformName(
  input: string | undefined,
  targetDir?: string
): Platform | undefined {
  if (!input) {
    return undefined
  }

  const state = getPlatformsState(targetDir)
  const normalized = input.toLowerCase()
  if (normalized in state.defs) {
    return normalized as Platform
  }

  return state.aliasLookup[normalized]
}

/**
 * Resolve a frontmatter/platform key (id or alias, case-insensitive) to a canonical platform id.
 * Returns null when the key is not a known platform or alias.
 */
export function resolvePlatformKey(
  key: string,
  targetDir?: string
): Platform | null {
  if (!key) return null

  const normalized = key.toLowerCase()
  const state = getPlatformsState(targetDir)

  if (normalized in state.defs) {
    return normalized as Platform
  }

  return state.aliasLookup[normalized] ?? null
}

/**
 * Internal helper to build directory paths for a single platform definition.
 */
function buildDirectoryPaths(
  definition: PlatformDefinition, 
  targetDir: string
): PlatformPaths {
  const subdirsPaths: Record<string, string> = {}
  
  // Build from export flows (the flows that define workspace structure)
  if (definition.export && definition.export.length > 0) {
    for (const flow of definition.export) {
      // Extract pattern from 'from' field
      const fromPattern = extractPatternString(flow.from);
      if (!fromPattern) continue;
      
      const firstComponent = fromPattern.split('/')[0]
      
      // Skip if it's a file (contains extension) or already exists
      if (firstComponent && !firstComponent.includes('.') && !subdirsPaths[firstComponent]) {
        // Extract platform subdir from 'to' pattern
        const toPattern = typeof flow.to === 'string' ? flow.to : Object.values(flow.to)[0]
        
        if (typeof toPattern === 'string') {
          // Get the directory part of the target path
          const targetPath = toPattern.split('/').slice(0, -1).join('/')
          
          if (targetPath) {
            subdirsPaths[firstComponent] = join(targetDir, targetPath)
          }
        }
      }
    }
  }

  const rootDir = deriveRootDirFromFlows(definition);
  
  return {
    rootDir: join(targetDir, rootDir),
    rootFile: definition.rootFile ? join(targetDir, definition.rootFile) : undefined,
    subdirs: subdirsPaths
  }
}

/**
 * Get platform directory paths for a given target directory
 */
export function getPlatformDirectoryPaths(targetDir: string): PlatformDirectoryPaths {
  const state = getPlatformsState(targetDir)
  const paths: PlatformDirectoryPaths = {}

  for (const platform of state.enabledPlatforms) {
    paths[platform] = buildDirectoryPaths(state.defs[platform], targetDir)
  }

  return paths
}

/**
 * Get directory paths for a specific platform.
 * @throws Error if platform unknown
 */
export function getPlatformDirectoryPathsForPlatform(
  platform: Platform,
  targetDir: string
): PlatformPaths {
  const state = getPlatformsState(targetDir)
  const definition = state.defs[platform]
  if (!definition) {
    throw new Error(`Unknown platform: ${platform}`)
  }
  return buildDirectoryPaths(definition, targetDir)
}

/**
 * Detect all platforms present in a directory
 * Checks both platform directories (.platform/) and unique root files (e.g., CLAUDE.md)
 * AGENTS.md is skipped as it's universal/ambiguous.
 */
export async function detectAllPlatforms(
  targetDir: string
): Promise<PlatformDetectionResult[]> {
  const state = getPlatformsState(targetDir)
  const detectionPromises = state.enabledPlatforms.map(
    async (platform) => {
      const definition = state.defs[platform]
      
      // Use new detection array if available
      if (definition.detection && definition.detection.length > 0) {
        // Check if any detection pattern matches
        for (const pattern of definition.detection) {
          const testPath = join(targetDir, pattern)
          if (await exists(testPath)) {
            return {
              name: platform,
              detected: true,
            }
          }
        }
        
        return {
          name: platform,
          detected: false,
        }
      }
      
      // Legacy detection using rootDir/rootFile
      let detected = false
      
      if (definition.rootDir) {
        const rootDirPath = join(targetDir, definition.rootDir)
        detected = await exists(rootDirPath)
      }
      
      if (!detected && definition.rootFile && definition.rootFile !== FILE_PATTERNS.AGENTS_MD) {
        const rootFilePath = join(targetDir, definition.rootFile)
        detected = await exists(rootFilePath)
      }

      return {
        name: platform,
        detected,
      }
    }
  )

  return await Promise.all(detectionPromises)
}

/**
 * Get detected platforms only
 */
export async function getDetectedPlatforms(cwd: string): Promise<Platform[]> {
  const results = await detectAllPlatforms(cwd)
  return results
    .filter((result) => result.detected)
    .map((result) => result.name)
}

/**
 * Validate platform directory structure
 */
export async function validatePlatformStructure(
  cwd: string,
  platform: Platform
): Promise<{ valid: boolean; issues: string[] }> {
  const state = getPlatformsState(cwd)
  const definition = state.defs[platform]
  if (!definition) {
    throw new Error(`Unknown platform: ${platform}`)
  }

  const issues: string[] = []

  // Check detection patterns if available
  if (definition.detection && definition.detection.length > 0) {
    // Detection patterns are used for source detection, not validation
    // Skip validation for now
  } else if (definition.rootFile) {
    // Legacy rootFile validation
    const rootFilePath = join(cwd, definition.rootFile)
    if (!(await exists(rootFilePath))) {
      issues.push(`Root file does not exist: ${rootFilePath}`)
    }
  }

  // TODO: Optionally check flow-based directories exist
  // (may not be necessary since flows handle missing directories gracefully)

  return {
    valid: issues.length === 0,
    issues,
  }
}

/**
 * Get file extensions allowed in a specific universal subdir for a platform
 * @param universalSubdir - The universal subdirectory name (e.g., 'rules', 'commands', or custom)
 * @returns Allowed extensions or empty array if subdir not supported
 */
export function getPlatformSubdirExts(
  platform: Platform,
  universalSubdir: string,
  targetDir?: string
): string[] {
  const state = getPlatformsState(targetDir)
  const definition = state.defs[platform]
  if (!definition) {
    throw new Error(`Unknown platform: ${platform}`)
  }
  
  // Check export flows
  if (definition.export && definition.export.length > 0) {
    const extensions = new Set<string>()
    
    for (const flow of definition.export) {
      // Extract pattern from 'from' field
      const fromPattern = extractPatternString(flow.from);
      if (!fromPattern) continue;
      
      // Check if this flow matches the universal subdir
      if (fromPattern.startsWith(`${universalSubdir}/`)) {
        // Extract extension from the 'from' pattern
        const extMatch = fromPattern.match(/\.[^./]+$/)
        if (extMatch) {
          extensions.add(extMatch[0])
        }
        
        // Also check 'to' pattern for extension changes
        const toPattern = typeof flow.to === 'string' ? flow.to : Object.values(flow.to)[0]
        if (typeof toPattern === 'string') {
          const toExtMatch = toPattern.match(/\.[^./]+$/)
          if (toExtMatch) {
            extensions.add(toExtMatch[0])
          }
        }
      }
    }
    
    if (extensions.size > 0) {
      return Array.from(extensions)
    }
  }
  
  logger.warn(`Platform ${platform} does not support universal subdir '${universalSubdir}'`)
  return []
}

/**
 * Get all universal subdirs that exist for a platform
 */
export function getPlatformUniversalSubdirs(
  targetDir: string,
  platform: Platform
): Array<{ dir: string; label: string; leaf: string }> {
  const paths = getPlatformDirectoryPathsForPlatform(platform, targetDir)
  const subdirs: Array<{ dir: string; label: string; leaf: string }> = []

  for (const [label, dir] of Object.entries(paths.subdirs)) {
    subdirs.push({
      dir,
      label,
      leaf: getPathLeaf(dir),
    })
  }

  return subdirs
}

/**
 * Check if a normalized path represents a universal subdir
 */
export function isUniversalSubdirPath(normalizedPath: string, targetDir?: string): boolean {
  const state = getPlatformsState(targetDir)
  for (const subdir of state.universalSubdirs) {
    if (
      normalizedPath.startsWith(`${subdir}/`) ||
      normalizedPath === subdir ||
      normalizedPath.startsWith(`${DIR_PATTERNS.OPENPACKAGE}/${subdir}/`) ||
      normalizedPath === `${DIR_PATTERNS.OPENPACKAGE}/${subdir}`
    ) {
      return true
    }
  }
  return false
}

/**
 * Check if a value is a valid platform ID.
 */
export function isPlatformId(
  value: string | undefined,
  targetDir?: string
): value is Platform {
  if (!value) return false
  return value in getPlatformsState(targetDir).defs
}

/**
 * Infer platform from workspace file information.
 * Attempts multiple strategies to determine the platform:
 * 1. Maps full path to universal path (if platform can be inferred from path structure)
 * 2. Checks if source directory or registry path indicates workspace install content
 * 3. Looks up platform from source directory using PLATFORM_DIR_LOOKUP
 * 4. Parses registry path for platform suffix (e.g., file.cursor.md)
 *
 * @param fullPath - Full absolute path to the file
 * @param sourceDir - Source directory name (e.g., '.cursor', 'ai')
 * @param registryPath - Registry path (e.g., 'rules/file.md')
 * @param targetDir - Optional target directory for local platform config overrides
 * @returns Platform ID, 'ai', or undefined if cannot be determined
 */
export function inferPlatformFromWorkspaceFile(
  fullPath: string,
  sourceDir: string,
  registryPath: string,
  targetDir?: string
): Platform | undefined {
  // First try to get platform from full path using existing mapper
  const mapping = mapPlatformFileToUniversal(fullPath, targetDir)
  if (mapping?.platform) {
    return mapping.platform
  }

  // Look up platform from source directory
  const fromSource = getPlatformDirLookup(targetDir)[sourceDir]
  if (fromSource) {
    return fromSource
  }
  
  // Fallback: derive platform root dirs from flows
  const state = getPlatformsState(targetDir)
  for (const [platformId, def] of Object.entries(state.defs)) {
    const derivedRoot = deriveRootDirFromFlows(def)
    if (derivedRoot === sourceDir) {
      return platformId as Platform
    }
  }

  // Fallback: check registry path for platform suffix
  const parsed = parseUniversalPath(registryPath, { allowPlatformSuffix: true })
  if (parsed?.platformSuffix && isPlatformId(parsed.platformSuffix, targetDir)) {
    return parsed.platformSuffix
  }

  return undefined
}
