/**
 * Platform Management Module
 * Centralized platform definitions, directory mappings, and file patterns
 * for all 13 supported AI coding platforms
 */

import { join, relative } from "path"
import { exists, ensureDir } from "../utils/fs.js"
import { logger } from "../utils/logger.js"
import { getPathLeaf } from "../utils/path-normalization.js"
import {
  DIR_PATTERNS,
  FILE_PATTERNS,
  type UniversalSubdir,
} from "../constants/index.js"
import { mapPlatformFileToUniversal } from "../utils/platform-mapper.js"
import { parseUniversalPath } from "../utils/platform-file.js"
import { readJsoncFileSync, readJsoncOrJson } from "../utils/jsonc.js"
import * as os from "os"
import { deepMerge } from "../utils/platform-yaml-merge.js"

export type Platform = string

// New unified platform definition structure
export interface SubdirFileTransformation {
  packageExt: string
  workspaceExt: string
}

export interface SubdirDef {
  // Base path under the platform root directory for this subdir
  // Examples: 'rules', 'memories', 'commands'
  path: string
  // Allowed workspace file extensions; undefined = all allowed, [] = none allowed
  exts?: string[]
  // Optional extension transformations between package (registry) and workspace
  transformations?: SubdirFileTransformation[]
}

export interface PlatformDefinition {
  id: Platform
  name: string
  rootDir: string
  rootFile?: string
  subdirs: Map<string, SubdirDef>  // Map<universalDir, SubdirDef>
  aliases?: string[]
  enabled: boolean
}

// Types for JSONC config structure (array format)
interface SubdirConfigEntry {
  universalDir: string   // Custom universal directory name
  platformDir: string    // Platform-specific path
  exts?: string[]
  transformations?: SubdirFileTransformation[]
}

interface PlatformConfig {
  name: string
  rootDir: string
  rootFile?: string
  subdirs: SubdirConfigEntry[]  // Array format in config
  aliases?: string[]
  enabled?: boolean
}

type PlatformsConfig = Record<string, PlatformConfig>

export interface PlatformsState {
  config: PlatformsConfig
  defs: Record<Platform, PlatformDefinition>
  dirLookup: Record<string, Platform>
  aliasLookup: Record<string, Platform>
  universalSubdirs: Set<string>
  rootFiles: string[]
  allPlatforms: Platform[]
  enabledPlatforms: Platform[]
}

/**
 * Create platform definitions from a PlatformsConfig object
 * Converts array-based config to Map-based internal representation for O(1) lookups
 * Assumes config is already validated.
 * @param config - The merged platforms configuration
 */
function createPlatformDefinitions(
  config: PlatformsConfig
): Record<Platform, PlatformDefinition> {
  const result: Record<Platform, PlatformDefinition> = {}

  for (const [id, cfg] of Object.entries(config)) {
    const platformId = id as Platform

    const subdirsMap = new Map<string, SubdirDef>()
    
    for (const entry of cfg.subdirs ?? []) {
      subdirsMap.set(entry.universalDir, {
        path: entry.platformDir,
        exts: entry.exts,
        transformations: entry.transformations,
      })
    }

    result[platformId] = {
      id: platformId,
      name: cfg.name,
      rootDir: cfg.rootDir,
      rootFile: cfg.rootFile,
      subdirs: subdirsMap,
      aliases: cfg.aliases,
      enabled: cfg.enabled !== false,
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
    const basePlat = base[platformId]
    if (!basePlat) {
      merged[platformId] = overridePlat
      continue
    }

    merged[platformId] = {
      name: overridePlat.name ?? basePlat.name,
      rootDir: overridePlat.rootDir ?? basePlat.rootDir,
      rootFile: overridePlat.rootFile ?? basePlat.rootFile,
      aliases: overridePlat.aliases ?? basePlat.aliases, // replace array
      enabled: overridePlat.enabled ?? basePlat.enabled,
      subdirs: (() => {
        const baseSub = Array.isArray(basePlat.subdirs) ? basePlat.subdirs : []
        const ovSub = Array.isArray(overridePlat.subdirs) ? overridePlat.subdirs : []
        return mergeSubdirsConfigs(baseSub, ovSub)
      })(),
    }
  }

  return merged
}

/**
 * Merge subdirs arrays by universalDir.
 * For matches, override specific fields if present.
 * Adds new entries; preserves base order.
 */
function mergeSubdirsConfigs(
  base: SubdirConfigEntry[], 
  overrideArr: SubdirConfigEntry[]
): SubdirConfigEntry[] {
  const baseMap = new Map<string, SubdirConfigEntry>(
    base.map(entry => [entry.universalDir, { ...entry }]) // shallow copy
  )

  for (const ovEntry of overrideArr) {
    const baseEntry = baseMap.get(ovEntry.universalDir)
    if (baseEntry) {
      // Override if field present and defined
      if ('platformDir' in ovEntry && ovEntry.platformDir !== undefined) {
        baseEntry.platformDir = ovEntry.platformDir
      }
      if ('exts' in ovEntry && ovEntry.exts !== undefined) {
        baseEntry.exts = ovEntry.exts
      }
      if ('transformations' in ovEntry && ovEntry.transformations !== undefined) {
        baseEntry.transformations = ovEntry.transformations
      }
    } else {
      baseMap.set(ovEntry.universalDir, { ...ovEntry })
    }
  }

  // Preserve base order, then append new
  const result: SubdirConfigEntry[] = []
  for (const entry of base) {
    result.push(baseMap.get(entry.universalDir)!)
  }
  for (const [key, entry] of baseMap) {
    if (!base.some(b => b.universalDir === key)) {
      result.push(entry)
    }
  }
  return result
}

/**
 * Validate a PlatformsConfig object and return any validation errors.
 * @param config - The config to validate
 * @returns Array of error messages; empty if valid
 */
export function validatePlatformsConfig(config: PlatformsConfig): string[] {
  const errors: string[] = []

  for (const [platformId, platConfig] of Object.entries(config)) {
    if (!platConfig.rootDir || platConfig.rootDir.trim() === '') {
      errors.push(`Platform '${platformId}': Missing or empty rootDir`)
    }
    if (!platConfig.name || platConfig.name.trim() === '') {
      errors.push(`Platform '${platformId}': Missing or empty name`)
    }

    if (platConfig.subdirs && Array.isArray(platConfig.subdirs)) {
      const seenUniversalDirs = new Set<string>()
      for (let index = 0; index < platConfig.subdirs.length; index++) {
        const entry = platConfig.subdirs[index]
        if (!entry || typeof entry !== 'object') {
          errors.push(`Platform '${platformId}', subdirs[${index}]: Invalid entry (must be object)`)
          continue
        }
        if (!entry.universalDir || typeof entry.universalDir !== 'string' || entry.universalDir.trim() === '') {
          errors.push(`Platform '${platformId}', subdirs[${index}].universalDir: Missing or invalid string`)
        } else if (seenUniversalDirs.has(entry.universalDir)) {
          errors.push(`Platform '${platformId}', subdirs[${index}]: Duplicate universalDir '${entry.universalDir}'`)
        } else {
          seenUniversalDirs.add(entry.universalDir)
        }
        if (!entry.platformDir || typeof entry.platformDir !== 'string' || entry.platformDir.trim() === '') {
          errors.push(`Platform '${platformId}', subdirs[${index}].platformDir: Missing or invalid string`)
        }
        if (entry.exts !== undefined && (!Array.isArray(entry.exts) || entry.exts.some((e: any) => typeof e !== 'string'))) {
          errors.push(`Platform '${platformId}', subdirs[${index}].exts: Must be array of strings or undefined`)
        }
        if (entry.transformations !== undefined) {
          if (!Array.isArray(entry.transformations)) {
            errors.push(`Platform '${platformId}', subdirs[${index}].transformations: Must be array or undefined`)
          } else {
            entry.transformations.forEach((t: any, tIndex: number) => {
              if (!t || typeof t !== 'object' || typeof t.packageExt !== 'string' || typeof t.workspaceExt !== 'string') {
                errors.push(`Platform '${platformId}', subdirs[${index}].transformations[${tIndex}]: Invalid {packageExt: string, workspaceExt: string}`)
              }
            })
          }
        }
      }
    } else if (platConfig.subdirs !== undefined) {
      errors.push(`Platform '${platformId}': subdirs must be array or undefined`)
    }

    if (platConfig.aliases !== undefined && (!Array.isArray(platConfig.aliases) || platConfig.aliases.some((a: any) => typeof a !== 'string'))) {
      errors.push(`Platform '${platformId}': aliases must be array of strings or undefined`)
    }
    if (typeof platConfig.enabled !== 'boolean' && platConfig.enabled !== undefined) {
      errors.push(`Platform '${platformId}': enabled must be boolean or undefined`)
    }
  }

  return errors
}

const GLOBAL_DIR = join(os.homedir(), ".openpackage")

const stateCache = new Map<string | null, PlatformsState>()

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

  // Create definitions and compute state
  const defs = createPlatformDefinitions(config)

  const dirLookup: Record<string, Platform> = {}
  const aliasLookup: Record<string, Platform> = {}
  const universalSubdirs = new Set<string>()
  const rootFiles: string[] = []
  const allPlatforms: Platform[] = []

  for (const def of Object.values(defs)) {
    allPlatforms.push(def.id)
    dirLookup[def.rootDir] = def.id
    for (const alias of def.aliases ?? []) {
      aliasLookup[alias.toLowerCase()] = def.id
    }
    for (const univ of def.subdirs.keys()) {
      universalSubdirs.add(univ)
    }
    if (def.rootFile) {
      rootFiles.push(def.rootFile)
    }
  }

  const enabledPlatforms = allPlatforms.filter(p => defs[p].enabled)

  const state: PlatformsState = {
    config,
    defs,
    dirLookup,
    aliasLookup,
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
 * Get all unique universal subdirectory names defined across all platforms.
 * This dynamically discovers what subdirs exist based on the loaded platform configs.
 * @param cwd - Optional cwd for local config overrides
 * @returns Set of all universal subdir names
 */
export function getAllUniversalSubdirs(cwd?: string): Set<string> {
  return new Set(getPlatformsState(cwd).universalSubdirs)
}

/**
 * Check if a string is a recognized universal subdir.
 * @param subdirName - Name to check
 * @param cwd - Optional cwd for local config overrides
 * @returns true if the subdir is defined in any platform
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
 * Internal helper to build directory paths for a single platform definition.
 */
function buildDirectoryPaths(
  definition: PlatformDefinition, 
  cwd: string
): PlatformPaths {
  const subdirsPaths: Record<string, string> = {}
  for (const [universalDir, subdirDef] of definition.subdirs.entries()) {
    subdirsPaths[universalDir] = join(cwd, definition.rootDir, subdirDef.path)
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
    for (const [universalDir, subdirDef] of definition.subdirs.entries()) {
      const dirPath = join(cwd, definition.rootDir, subdirDef.path)
      try {
        const dirExists = await exists(dirPath)
        if (!dirExists) {
          await ensureDir(dirPath)
          created.push(relative(cwd, dirPath))
          logger.debug(`Created platform directory ${universalDir}: ${dirPath}`)
        }
      } catch (error) {
        logger.error(
          `Failed to create platform directory ${universalDir} (${dirPath}): ${error}`
        )
      }
    }
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

  // Check all subdirs directories exist
  for (const [universalDir, subdirDef] of definition.subdirs.entries()) {
    const dirPath = join(cwd, definition.rootDir, subdirDef.path)
    if (!(await exists(dirPath))) {
      issues.push(`${universalDir} directory does not exist: ${dirPath}`)
    }
  }

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
  const subdirDef = definition.subdirs.get(universalSubdir)
  if (!subdirDef) {
    logger.warn(`Platform ${platform} does not support universal subdir '${universalSubdir}'`)
    return []
  }
  return subdirDef.exts || []
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
 * Determine whether an extension is allowed for a given subdir definition.
 */
export function isExtAllowed(
  subdirDef: SubdirDef | undefined,
  ext: string
): boolean {
  if (!subdirDef) {
    return false
  }
  if (subdirDef.exts === undefined) {
    return true
  }
  if (subdirDef.exts.length === 0) {
    return false
  }
  return subdirDef.exts.includes(ext)
}

/**
 * Convert a package (registry) extension to the workspace extension.
 * Falls back to the original extension if no transformation applies.
 */
export function getWorkspaceExt(
  subdirDef: SubdirDef,
  packageExt: string
): string {
  if (!subdirDef.transformations || packageExt === "") {
    return packageExt
  }
  const transformation = subdirDef.transformations.find(
    ({ packageExt: candidate }) => candidate === packageExt
  )
  return transformation?.workspaceExt ?? packageExt
}

/**
 * Convert a workspace extension to the package (registry) extension.
 * Falls back to the original extension if no transformation applies.
 */
export function getPackageExt(
  subdirDef: SubdirDef,
  workspaceExt: string
): string {
  if (!subdirDef.transformations || workspaceExt === "") {
    return workspaceExt
  }
  const transformation = subdirDef.transformations.find(
    ({ workspaceExt: candidate }) => candidate === workspaceExt
  )
  return transformation?.packageExt ?? workspaceExt
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
