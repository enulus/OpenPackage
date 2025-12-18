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
  UNIVERSAL_SUBDIRS,
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
  subdirs: Partial<Record<UniversalSubdir, SubdirDef>>
  aliases?: string[]
  enabled: boolean
}

// Types for JSONC config structure
interface PlatformConfig {
  name: string
  rootDir: string
  rootFile?: string
  subdirs: Partial<Record<string, SubdirDef>>
  aliases?: string[]
  enabled?: boolean
}

type PlatformsConfig = Record<string, PlatformConfig>

/**
 * Create platform definitions from a PlatformsConfig object
 * @param config - The merged platforms configuration
 */
function createPlatformDefinitions(
  config: PlatformsConfig
): Record<Platform, PlatformDefinition> {
  const result: Partial<Record<Platform, PlatformDefinition>> = {}

  for (const [id, cfg] of Object.entries(config)) {
    const platformId = id as Platform

    result[platformId] = {
      id: platformId,
      name: cfg.name,
      rootDir: cfg.rootDir,
      rootFile: cfg.rootFile,
      // Normalize subdirs inline
      subdirs: (() => {
        const subdirsNorm: Partial<Record<UniversalSubdir, SubdirDef>> = {}
        if (cfg.subdirs) {
          for (const [subdirKey, subdirConfig] of Object.entries(cfg.subdirs)) {
            if (!isValidUniversalSubdir(subdirKey)) {
              logger.warn(
                `Invalid universal subdir key in platforms.jsonc: ${subdirKey}`
              )
              continue
            }
            if (!subdirConfig) continue
            subdirsNorm[subdirKey as UniversalSubdir] = subdirConfig
          }
        }
        return subdirsNorm
      })(),
      aliases: cfg.aliases,
      enabled: cfg.enabled !== false,
    }
  }

  return result as Record<Platform, PlatformDefinition>
}

const BUILT_IN_CONFIG: PlatformsConfig =
  readJsoncFileSync<PlatformsConfig>("platforms.jsonc")

const GLOBAL_DIR = join(os.homedir(), ".openpackage")
// Global config loaded lazily
const globalConfigCache = new Map<"merged" | "defs", unknown>()

function getGlobalMergedConfig(): PlatformsConfig {
  if (globalConfigCache.has("merged")) {
    return globalConfigCache.get("merged") as PlatformsConfig
  }
  const globalFile =
    readJsoncOrJson(join(GLOBAL_DIR, "platforms.jsonc")) ??
    readJsoncOrJson(join(GLOBAL_DIR, "platforms.json"))
  const merged = globalFile
    ? (deepMerge(BUILT_IN_CONFIG, globalFile) as PlatformsConfig)
    : BUILT_IN_CONFIG
  globalConfigCache.set("merged", merged)
  return merged
}

export function getGlobalDefinitions(): Record<Platform, PlatformDefinition> {
  if (globalConfigCache.has("defs")) {
    return globalConfigCache.get("defs") as Record<Platform, PlatformDefinition>
  }
  const defs = createPlatformDefinitions(getGlobalMergedConfig())
  globalConfigCache.set("defs", defs)
  return defs
}

const localConfigCache = new Map<string, PlatformsConfig>()
const localDefsCache = new Map<string, Record<Platform, PlatformDefinition>>()

/**
 * Get platform definitions with local cwd overrides merged on top.
 * Caches merged config and definitions per cwd for performance.
 * @param cwd - Optional current working directory for local overrides
 * @returns Merged platform definitions
 */
export function getPlatformDefinitions(
  cwd?: string
): Record<Platform, PlatformDefinition> {
  if (cwd === undefined) {
    return getGlobalDefinitions()
  }

  if (localDefsCache.has(cwd)) {
    return localDefsCache.get(cwd)!
  }

  let mergedConfig: PlatformsConfig
  const cachedConfig = localConfigCache.get(cwd)
  if (cachedConfig !== undefined) {
    mergedConfig = cachedConfig
  } else {
    const localDir = join(cwd, DIR_PATTERNS.OPENPACKAGE)
    const localFile =
      readJsoncOrJson(join(localDir, "platforms.jsonc")) ??
      readJsoncOrJson(join(localDir, "platforms.json"))
    mergedConfig = localFile
      ? (deepMerge(getGlobalMergedConfig(), localFile) as PlatformsConfig)
      : getGlobalMergedConfig()
    localConfigCache.set(cwd, mergedConfig)
  }

  const defs = createPlatformDefinitions(mergedConfig)
  localDefsCache.set(cwd, defs)

  return defs
}

// Backwards compatibility alias (deprecated - use getPlatformDefinitions() instead)
export const PLATFORM_DEFINITIONS = getGlobalDefinitions()

/**
 * Get all platform IDs (including disabled)
 */
export function getAllPlatformIds(cwd?: string): Platform[] {
  return Object.keys(getPlatformDefinitions(cwd)) as Platform[]
}

// Global versions for backwards compatibility and non-cwd uses
export const ALL_PLATFORMS: Platform[] = getAllPlatformIds()

const dirLookupCache = new Map<string | undefined, Record<string, Platform>>()

/**
 * Get lookup map from platform directory name to platform ID.
 * Cached per cwd for performance.
 */
export function getPlatformDirLookup(cwd?: string): Record<string, Platform> {
  const key = cwd ?? "global"
  if (dirLookupCache.has(key)) {
    return dirLookupCache.get(key)!
  }
  const defs = getPlatformDefinitions(cwd)
  const map: Record<string, Platform> = {}
  for (const def of Object.values(defs)) {
    map[def.rootDir] = def.id
  }
  dirLookupCache.set(key, map)
  return map
}

// Deprecated global lookup removed: use getPlatformDirLookup(cwd?)

const aliasLookupCache = new Map<string | undefined, Record<string, Platform>>()

/**
 * Get lookup map from platform alias to platform ID.
 * Cached per cwd for performance.
 */
export function getPlatformAliasLookup(cwd?: string): Record<string, Platform> {
  const key = cwd ?? "global"
  if (aliasLookupCache.has(key)) {
    return aliasLookupCache.get(key)!
  }
  const defs = getPlatformDefinitions(cwd)
  const map: Record<string, Platform> = {}
  for (const def of Object.values(defs)) {
    for (const alias of def.aliases ?? []) {
      map[alias.toLowerCase()] = def.id
    }
  }
  aliasLookupCache.set(key, map)
  return map
}

// Deprecated global lookup removed: use getPlatformAliasLookup(cwd?)

/**
 * Get all known platform root files.
 */
export function getPlatformRootFiles(cwd?: string): string[] {
  const defs = getPlatformDefinitions(cwd)
  return Object.values(defs)
    .map((def) => def.rootFile)
    .filter((file): file is string => typeof file === "string")
}

// Backwards compatibility (deprecated)
export const PLATFORM_ROOT_FILES = Object.freeze(getPlatformRootFiles())

// Legacy type definitions for compatibility
export type PlatformName = Platform
export type PlatformCategory = string

export interface PlatformDetectionResult {
  name: Platform
  detected: boolean
}

export interface PlatformDirectoryPaths {
  [platformName: string]: {
    rulesDir: string
    rootFile?: string
    commandsDir?: string
    agentsDir?: string
    skillsDir?: string
  }
}

/**
 * Get platform definition by name
 * @throws Error if platform not found
 */
export function getPlatformDefinition(
  name: Platform,
  cwd?: string
): PlatformDefinition {
  const defs = getPlatformDefinitions(cwd)
  const def = defs[name]
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
  const defs = getPlatformDefinitions(cwd)
  const ids = Object.keys(defs) as Platform[]

  if (options?.includeDisabled) {
    return ids
  }
  return ids.filter((platform) => defs[platform].enabled)
}

export function resolvePlatformName(
  input: string | undefined,
  cwd?: string
): Platform | undefined {
  if (!input) {
    return undefined
  }

  const defs = getPlatformDefinitions(cwd)
  const normalized = input.toLowerCase()
  if (normalized in defs) {
    return normalized as Platform
  }

  const aliasLookup = getPlatformAliasLookup(cwd)
  return aliasLookup[normalized]
}

export function getAllRootFiles(cwd?: string): string[] {
  return getPlatformRootFiles(cwd)
}

/**
 * Get platform directory paths for a given working directory
 */
export function getPlatformDirectoryPaths(cwd: string): PlatformDirectoryPaths {
  const paths: PlatformDirectoryPaths = {}

  for (const platform of getAllPlatforms(undefined, cwd)) {
    const definition = getPlatformDefinition(platform, cwd)
    const rulesSubdir = definition.subdirs[UNIVERSAL_SUBDIRS.RULES]
    paths[platform] = {
      rulesDir: join(cwd, definition.rootDir, rulesSubdir?.path || ""),
    }

    if (definition.rootFile) {
      paths[platform].rootFile = join(cwd, definition.rootFile)
    }

    const commandsSubdir = definition.subdirs[UNIVERSAL_SUBDIRS.COMMANDS]
    if (commandsSubdir) {
      paths[platform].commandsDir = join(
        cwd,
        definition.rootDir,
        commandsSubdir.path
      )
    }

    const agentsSubdir = definition.subdirs[UNIVERSAL_SUBDIRS.AGENTS]
    if (agentsSubdir) {
      paths[platform].agentsDir = join(
        cwd,
        definition.rootDir,
        agentsSubdir.path
      )
    }

    const skillsSubdir = definition.subdirs[UNIVERSAL_SUBDIRS.SKILLS]
    if (skillsSubdir) {
      paths[platform].skillsDir = join(
        cwd,
        definition.rootDir,
        skillsSubdir.path
      )
    }
  }

  return paths
}

/**
 * Detect all platforms present in a directory
 * Checks both platform directories (.platform/) and unique root files (e.g., CLAUDE.md)
 * AGENTS.md is skipped as it's universal/ambiguous.
 */
export async function detectAllPlatforms(
  cwd: string
): Promise<PlatformDetectionResult[]> {
  const detectionPromises = getAllPlatforms(undefined, cwd).map(
    async (platform) => {
      const definition = getPlatformDefinition(platform, cwd)
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
  const created: string[] = []
  const paths = getPlatformDirectoryPaths(cwd)

  for (const platform of platforms) {
    const platformPaths = paths[platform]

    try {
      const dirExists = await exists(platformPaths.rulesDir)
      if (!dirExists) {
        await ensureDir(platformPaths.rulesDir)
        created.push(relative(cwd, platformPaths.rulesDir))
        logger.debug(`Created platform directory: ${platformPaths.rulesDir}`)
      }
    } catch (error) {
      logger.error(
        `Failed to create platform directory ${platformPaths.rulesDir}: ${error}`
      )
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
  const issues: string[] = []
  const definition = getPlatformDefinition(platform, cwd)
  const paths = getPlatformDirectoryPaths(cwd)
  const platformPaths = paths[platform]

  // Check if rules directory exists
  if (!(await exists(platformPaths.rulesDir))) {
    issues.push(`Rules directory does not exist: ${platformPaths.rulesDir}`)
  }

  // Check root file for platforms that require it
  if (definition.rootFile && platformPaths.rootFile) {
    if (!(await exists(platformPaths.rootFile))) {
      issues.push(`Root file does not exist: ${platformPaths.rootFile}`)
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  }
}

/**
 * Get rules directory file patterns for a specific platform
 */
export function getPlatformRulesDirFilePatterns(
  platform: Platform,
  cwd?: string
): string[] {
  const definition = getPlatformDefinition(platform, cwd)
  return definition.subdirs[UNIVERSAL_SUBDIRS.RULES]?.exts || []
}

/**
 * Get all universal subdirs that exist for a platform
 */
export function getPlatformUniversalSubdirs(
  cwd: string,
  platform: Platform
): Array<{ dir: string; label: string; leaf: string }> {
  const paths = getPlatformDirectoryPaths(cwd)
  const platformPaths = paths[platform]
  const subdirs: Array<{ dir: string; label: string; leaf: string }> = []

  if (platformPaths.rulesDir)
    subdirs.push({
      dir: platformPaths.rulesDir,
      label: UNIVERSAL_SUBDIRS.RULES,
      leaf: getPathLeaf(platformPaths.rulesDir),
    })
  if (platformPaths.commandsDir)
    subdirs.push({
      dir: platformPaths.commandsDir,
      label: UNIVERSAL_SUBDIRS.COMMANDS,
      leaf: getPathLeaf(platformPaths.commandsDir),
    })
  if (platformPaths.agentsDir)
    subdirs.push({
      dir: platformPaths.agentsDir,
      label: UNIVERSAL_SUBDIRS.AGENTS,
      leaf: getPathLeaf(platformPaths.agentsDir),
    })
  if (platformPaths.skillsDir)
    subdirs.push({
      dir: platformPaths.skillsDir,
      label: UNIVERSAL_SUBDIRS.SKILLS,
      leaf: getPathLeaf(platformPaths.skillsDir),
    })

  return subdirs
}

/**
 * Check if a normalized path represents a universal subdir
 */
export function isUniversalSubdirPath(normalizedPath: string): boolean {
  return Object.values(UNIVERSAL_SUBDIRS).some((subdir) => {
    return (
      normalizedPath.startsWith(`${subdir}/`) ||
      normalizedPath === subdir ||
      normalizedPath.startsWith(`${DIR_PATTERNS.OPENPACKAGE}/${subdir}/`) ||
      normalizedPath === `${DIR_PATTERNS.OPENPACKAGE}/${subdir}`
    )
  })
}

/**
 * Check if a subKey is a valid universal subdir
 * Used for validating subdir keys before processing
 */
export function isValidUniversalSubdir(subKey: string): boolean {
  return Object.values(UNIVERSAL_SUBDIRS).includes(
    subKey as (typeof UNIVERSAL_SUBDIRS)[keyof typeof UNIVERSAL_SUBDIRS]
  )
}

/**
 * Check if a value is a valid platform ID.
 */
export function isPlatformId(
  value: string | undefined,
  cwd?: string
): value is Platform {
  if (!value) return false
  const defs = getPlatformDefinitions(cwd)
  return value in defs
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
