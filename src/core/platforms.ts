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
import type { Flow } from "../types/flows.js"
import type { GlobalFlowsConfig } from "../types/platform-flows.js"
import { 
  matchesAnyPattern, 
  extractSubdirectoriesFromPatterns 
} from "./universal-patterns.js"

export type Platform = string

// Platform definition structure - flows-only (no legacy subdirs)
export interface PlatformDefinition {
  id: Platform
  name: string
  rootDir: string
  rootFile?: string
  flows: Flow[]  // Flow-based transformations (required for non-rootFile-only platforms)
  aliases?: string[]
  enabled: boolean
  description?: string
  variables?: Record<string, any>
}

// Types for JSONC config structure (array format)
interface PlatformConfig {
  name: string
  rootDir: string
  rootFile?: string
  flows?: Flow[]  // Flow-based transformations (required unless rootFile-only platform)
  aliases?: string[]
  enabled?: boolean
  description?: string
  variables?: Record<string, any>
}

type PlatformsConfig = Record<string, PlatformConfig | GlobalFlowsConfig>

export interface PlatformsState {
  config: PlatformsConfig
  globalFlows?: Flow[]  // Global flows applied to all platforms
  defs: Record<Platform, PlatformDefinition>
  dirLookup: Record<string, Platform>
  aliasLookup: Record<string, Platform>
  universalPatterns: Set<string>  // All 'from' patterns from flows (source of truth)
  universalSubdirs: Set<string>  // Derived from patterns for backward compatibility
  rootFiles: string[]
  allPlatforms: Platform[]
  enabledPlatforms: Platform[]
}

/**
 * Check if a config entry is a global flows config
 */
function isGlobalFlowsConfig(cfg: PlatformConfig | GlobalFlowsConfig): cfg is GlobalFlowsConfig {
  return 'flows' in cfg && !('name' in cfg) && !('rootDir' in cfg)
}

/**
 * Create platform definitions from a PlatformsConfig object
 * Flows-only configuration (no legacy subdirs support)
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
      flows: platformConfig.flows || [],
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
      aliases: overrideCfg.aliases ?? baseCfg.aliases, // replace array
      enabled: overrideCfg.enabled ?? baseCfg.enabled,
      description: overrideCfg.description ?? baseCfg.description,
      variables: overrideCfg.variables ?? baseCfg.variables,
      flows: overrideCfg.flows ?? baseCfg.flows, // replace array (no merge)
    }
  }

  return merged
}

/**
 * Validate a PlatformsConfig object and return any validation errors.
 * Flows-only configuration (no legacy subdirs support).
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

    if (!cfg.rootDir || cfg.rootDir.trim() === '') {
      errors.push(`Platform '${platformId}': Missing or empty rootDir`)
    }
    if (!cfg.name || cfg.name.trim() === '') {
      errors.push(`Platform '${platformId}': Missing or empty name`)
    }

    // Validate flows
    if (cfg.flows !== undefined) {
      if (!Array.isArray(cfg.flows)) {
        errors.push(`Platform '${platformId}': flows must be array or undefined`)
      } else {
        errors.push(...validateFlows(cfg.flows, platformId))
      }
    }

    // Validate that flows is present (unless rootFile-only platform like Warp)
    if ((!cfg.flows || cfg.flows.length === 0) && !cfg.rootFile) {
      errors.push(`Platform '${platformId}': Must define either 'flows' or 'rootFile'`)
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
 * Validate global flows configuration
 */
function validateGlobalFlowsConfig(config: GlobalFlowsConfig): string[] {
  const errors: string[] = []
  
  if (config.flows !== undefined) {
    if (!Array.isArray(config.flows)) {
      errors.push(`Global config: flows must be array or undefined`)
    } else {
      errors.push(...validateFlows(config.flows, 'global'))
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
function validateFlows(flows: Flow[], context: string): string[] {
  const errors: string[] = []
  
  for (let i = 0; i < flows.length; i++) {
    const flow = flows[i]
    
    // Required fields
    if (!flow.from || typeof flow.from !== 'string' || flow.from.trim() === '') {
      errors.push(`${context}, flows[${i}]: Missing or invalid 'from' field`)
    }
    
    if (!flow.to) {
      errors.push(`${context}, flows[${i}]: Missing 'to' field`)
    } else if (typeof flow.to !== 'string' && typeof flow.to !== 'object') {
      errors.push(`${context}, flows[${i}]: 'to' must be string or object`)
    }
    
    // Validate merge strategy
    if (flow.merge !== undefined) {
      const validMerges = ['replace', 'shallow', 'deep', 'composite']
      if (!validMerges.includes(flow.merge)) {
        errors.push(`${context}, flows[${i}]: Invalid merge strategy '${flow.merge}'. Must be one of: ${validMerges.join(', ')}`)
      }
    }
    
    // Validate pipe transforms
    if (flow.pipe !== undefined) {
      if (!Array.isArray(flow.pipe)) {
        errors.push(`${context}, flows[${i}]: 'pipe' must be array or undefined`)
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
export function clearPlatformsCache(cwd?: string): void {
  if (cwd !== undefined) {
    stateCache.delete(cwd)
  } else {
    stateCache.clear()
  }
}

function getPlatformsState(cwd?: string | null): PlatformsState {
  const key = cwd ?? null
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
  const globalFlows = (globalConfig && isGlobalFlowsConfig(globalConfig)) 
    ? globalConfig.flows 
    : undefined

  // Create definitions and compute state
  const defs = createPlatformDefinitions(config)

  const dirLookup: Record<string, Platform> = {}
  const aliasLookup: Record<string, Platform> = {}
  const universalPatterns = new Set<string>()
  const rootFiles: string[] = []
  const allPlatforms: Platform[] = []

  // Collect all universal patterns from platform flows
  for (const def of Object.values(defs)) {
    allPlatforms.push(def.id)
    dirLookup[def.rootDir] = def.id
    for (const alias of def.aliases ?? []) {
      aliasLookup[alias.toLowerCase()] = def.id
    }
    
    // Collect all 'from' patterns from flows
    if (def.flows && def.flows.length > 0) {
      for (const flow of def.flows) {
        universalPatterns.add(flow.from)
      }
    }
    
    if (def.rootFile) {
      rootFiles.push(def.rootFile)
    }
  }

  // Add patterns from global flows
  if (globalFlows && globalFlows.length > 0) {
    for (const flow of globalFlows) {
      universalPatterns.add(flow.from)
    }
  }

  // Derive subdirectories from patterns (backward compatibility)
  const universalSubdirs = extractSubdirectoriesFromPatterns(universalPatterns)

  const enabledPlatforms = allPlatforms.filter(p => defs[p].enabled)

  const state: PlatformsState = {
    config,
    globalFlows,
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
  cwd?: string
): Record<Platform, PlatformDefinition> {
  return getPlatformsState(cwd).defs
}

/**
 * Get global flows that apply to all platforms
 */
export function getGlobalFlows(cwd?: string): Flow[] | undefined {
  return getPlatformsState(cwd).globalFlows
}

/**
 * Check if a platform uses flow-based configuration
 */
export function platformUsesFlows(platform: Platform, cwd?: string): boolean {
  try {
    const def = getPlatformDefinition(platform, cwd)
    return def.flows !== undefined && def.flows.length > 0
  } catch (error) {
    // Platform not found - return false
    return false
  }
}

/**
 * Check if a platform uses legacy subdirs configuration
 * @deprecated Always returns false - subdirs support removed
 */
export function platformUsesSubdirs(platform: Platform, cwd?: string): boolean {
  return false
}

/**
 * Get all universal path patterns from flow definitions.
 * These patterns define which files are considered universal package content.
 * This is the source of truth for determining what belongs in a package.
 * 
 * @param cwd - Optional cwd for local config overrides
 * @returns Set of glob patterns from all platform flows
 * 
 * @example
 * // Returns: Set(["rules/**\/*.md", "mcp.jsonc", "commands/*.md", ...])
 * const patterns = getAllUniversalPatterns()
 */
export function getAllUniversalPatterns(cwd?: string): Set<string> {
  return new Set(getPlatformsState(cwd).universalPatterns)
}

/**
 * Check if a file path matches any universal pattern from flows.
 * This is the primary method for determining if a file is universal content.
 * 
 * @param filePath - File path to check (normalized, no leading slash)
 * @param cwd - Optional cwd for local config overrides
 * @returns true if path matches any universal pattern
 * 
 * @example
 * matchesUniversalPattern("mcp.jsonc") // true (if defined in flows)
 * matchesUniversalPattern("rules/typescript.md") // true
 * matchesUniversalPattern("random-file.txt") // false
 */
export function matchesUniversalPattern(filePath: string, cwd?: string): boolean {
  const patterns = getAllUniversalPatterns(cwd)
  return matchesAnyPattern(filePath, patterns)
}

/**
 * Get all unique universal subdirectory names defined across all platforms.
 * This is derived from universal patterns for backward compatibility.
 * 
 * @param cwd - Optional cwd for local config overrides
 * @returns Set of all universal subdir names
 * @deprecated Prefer using matchesUniversalPattern for file validation
 */
export function getAllUniversalSubdirs(cwd?: string): Set<string> {
  return new Set(getPlatformsState(cwd).universalSubdirs)
}

/**
 * Check if a string is a recognized universal subdir.
 * 
 * @param subdirName - Name to check
 * @param cwd - Optional cwd for local config overrides
 * @returns true if the subdir is defined in any platform
 * @deprecated Prefer using matchesUniversalPattern for file validation
 */
export function isKnownUniversalSubdir(subdirName: string, cwd?: string): boolean {
  return getPlatformsState(cwd).universalSubdirs.has(subdirName)
}

/**
 * Get lookup map from platform directory name to platform ID.
 */
export function getPlatformDirLookup(cwd?: string): Record<string, Platform> {
  return getPlatformsState(cwd).dirLookup
}

/**
 * Get lookup map from platform alias to platform ID.
 */
export function getPlatformAliasLookup(cwd?: string): Record<string, Platform> {
  return getPlatformsState(cwd).aliasLookup
}

/**
 * Get all known platform root files.
 */
export function getPlatformRootFiles(cwd?: string): string[] {
  return getPlatformsState(cwd).rootFiles
}



export interface PlatformDetectionResult {
  name: Platform
  detected: boolean
}

export type PlatformPaths = {
  rootDir: string
  rootFile?: string
  subdirs: Record<string, string> // universalDir -> full directory path
}

export interface PlatformDirectoryPaths {
  [platformName: string]: PlatformPaths
}

/**
 * Get platform definition by name
 * @throws Error if platform not found
 */
export function getPlatformDefinition(
  name: Platform,
  cwd?: string
): PlatformDefinition {
  const state = getPlatformsState(cwd)
  const def = state.defs[name]
  if (!def) {
    throw new Error(`Unknown platform: ${name}`)
  }
  return def
}

/**
 * Get all platforms
 */
export function getAllPlatforms(
  options?: { includeDisabled?: boolean },
  cwd?: string
): Platform[] {
  const state = getPlatformsState(cwd)
  if (options?.includeDisabled) {
    return state.allPlatforms
  }
  return state.enabledPlatforms
}

export function resolvePlatformName(
  input: string | undefined,
  cwd?: string
): Platform | undefined {
  if (!input) {
    return undefined
  }

  const state = getPlatformsState(cwd)
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
  cwd?: string
): Platform | null {
  if (!key) return null

  const normalized = key.toLowerCase()
  const state = getPlatformsState(cwd)

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
  cwd: string
): PlatformPaths {
  const subdirsPaths: Record<string, string> = {}
  
  // Build from flows
  if (definition.flows && definition.flows.length > 0) {
    for (const flow of definition.flows) {
      // Extract universal subdir from 'from' pattern
      const fromPattern = flow.from
      const firstComponent = fromPattern.split('/')[0]
      
      // Skip if it's a file (contains extension) or already exists
      if (firstComponent && !firstComponent.includes('.') && !subdirsPaths[firstComponent]) {
        // Extract platform subdir from 'to' pattern
        const toPattern = typeof flow.to === 'string' ? flow.to : Object.values(flow.to)[0]
        
        if (typeof toPattern === 'string') {
          // Get the directory part of the target path
          const targetPath = toPattern.split('/').slice(0, -1).join('/')
          
          if (targetPath) {
            subdirsPaths[firstComponent] = join(cwd, targetPath)
          }
        }
      }
    }
  }

  return {
    rootDir: join(cwd, definition.rootDir),
    rootFile: definition.rootFile ? join(cwd, definition.rootFile) : undefined,
    subdirs: subdirsPaths
  }
}

/**
 * Get platform directory paths for a given working directory
 */
export function getPlatformDirectoryPaths(cwd: string): PlatformDirectoryPaths {
  const state = getPlatformsState(cwd)
  const paths: PlatformDirectoryPaths = {}

  for (const platform of state.enabledPlatforms) {
    paths[platform] = buildDirectoryPaths(state.defs[platform], cwd)
  }

  return paths
}

/**
 * Get directory paths for a specific platform.
 * @throws Error if platform unknown
 */
export function getPlatformDirectoryPathsForPlatform(
  platform: Platform,
  cwd: string
): PlatformPaths {
  const state = getPlatformsState(cwd)
  const definition = state.defs[platform]
  if (!definition) {
    throw new Error(`Unknown platform: ${platform}`)
  }
  return buildDirectoryPaths(definition, cwd)
}

/**
 * Detect all platforms present in a directory
 * Checks both platform directories (.platform/) and unique root files (e.g., CLAUDE.md)
 * AGENTS.md is skipped as it's universal/ambiguous.
 */
export async function detectAllPlatforms(
  cwd: string
): Promise<PlatformDetectionResult[]> {
  const state = getPlatformsState(cwd)
  const detectionPromises = state.enabledPlatforms.map(
    async (platform) => {
      const definition = state.defs[platform]
      const rootDirPath = join(cwd, definition.rootDir)

      // Detected if root dir exists OR unique root file exists (skip AGENTS.md)
      const dirExists = await exists(rootDirPath)
      let fileExists = false
      if (
        definition.rootFile &&
        definition.rootFile !== FILE_PATTERNS.AGENTS_MD
      ) {
        const rootFilePath = join(cwd, definition.rootFile)
        fileExists = await exists(rootFilePath)
      }
      const detected = dirExists || fileExists

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
 * Create platform directories
 */
/**
 * Create platform directories
 * @deprecated Subdirs support removed - flows create directories as needed
 * Only creates root directory for platforms now
 */
export async function createPlatformDirectories(
  cwd: string,
  platforms: Platform[]
): Promise<string[]> {
  const state = getPlatformsState(cwd)
  const created: string[] = []

  for (const platform of platforms) {
    const definition = state.defs[platform]
    if (!definition) {
      throw new Error(`Unknown platform: ${platform}`)
    }
    
    // Only create root directory
    const rootPath = join(cwd, definition.rootDir)
    try {
      const dirExists = await exists(rootPath)
      if (!dirExists) {
        await ensureDir(rootPath)
        created.push(relative(cwd, rootPath))
        logger.debug(`Created platform root directory: ${rootPath}`)
      }
    } catch (error) {
      logger.error(
        `Failed to create platform root directory (${rootPath}): ${error}`
      )
    }
    
    // Flow-based installations will create subdirectories as needed
  }

  return created
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

  // Check root file
  if (definition.rootFile) {
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
  cwd?: string
): string[] {
  const state = getPlatformsState(cwd)
  const definition = state.defs[platform]
  if (!definition) {
    throw new Error(`Unknown platform: ${platform}`)
  }
  
  // Check flows
  if (definition.flows && definition.flows.length > 0) {
    const extensions = new Set<string>()
    
    for (const flow of definition.flows) {
      // Check if this flow matches the universal subdir
      if (flow.from.startsWith(`${universalSubdir}/`)) {
        // Extract extension from the 'from' pattern
        const fromPattern = flow.from
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
  cwd: string,
  platform: Platform
): Array<{ dir: string; label: string; leaf: string }> {
  const paths = getPlatformDirectoryPathsForPlatform(platform, cwd)
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
export function isUniversalSubdirPath(normalizedPath: string, cwd?: string): boolean {
  const state = getPlatformsState(cwd)
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
  cwd?: string
): value is Platform {
  if (!value) return false
  return value in getPlatformsState(cwd).defs
}

/**
 * @deprecated Subdirs support removed - use flows instead
 * Always returns false for backward compatibility
 */
export function isExtAllowed(
  subdirDef: any,
  ext: string
): boolean {
  return false
}

/**
 * @deprecated Subdirs support removed - use flows instead
 * Always returns original extension for backward compatibility
 */
export function getWorkspaceExt(
  subdirDef: any,
  packageExt: string
): string {
  return packageExt
}

/**
 * @deprecated Subdirs support removed - use flows instead
 * Always returns original extension for backward compatibility
 */
export function getPackageExt(
  subdirDef: any,
  workspaceExt: string
): string {
  return workspaceExt
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
 * @param cwd - Optional cwd for local platform config overrides
 * @returns Platform ID, 'ai', or undefined if cannot be determined
 */
export function inferPlatformFromWorkspaceFile(
  fullPath: string,
  sourceDir: string,
  registryPath: string,
  cwd?: string
): Platform | undefined {
  // First try to get platform from full path using existing mapper
  const mapping = mapPlatformFileToUniversal(fullPath, cwd)
  if (mapping?.platform) {
    return mapping.platform
  }

  // Look up platform from source directory
  const fromSource = getPlatformDirLookup(cwd)[sourceDir]
  if (fromSource) {
    return fromSource
  }

  // Fallback: check registry path for platform suffix
  const parsed = parseUniversalPath(registryPath, { allowPlatformSuffix: true })
  if (parsed?.platformSuffix && isPlatformId(parsed.platformSuffix, cwd)) {
    return parsed.platformSuffix
  }

  return undefined
}
