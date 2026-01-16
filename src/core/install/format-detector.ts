/**
 * Format Detector Module
 * 
 * Detects package format (universal vs platform-specific) by analyzing file structure.
 * Used to determine conversion strategy during installation.
 */

import { dirname } from 'path';
import type { Platform } from '../platforms.js';
import type { PackageFile } from '../../types/index.js';
import { getAllPlatforms, isPlatformId } from '../platforms.js';
import { logger } from '../../utils/logger.js';

/**
 * Package format classification
 */
export interface PackageFormat {
  /**
   * Format type: universal (commands/, agents/) or platform-specific (.claude/, .cursor/)
   */
  type: 'universal' | 'platform-specific';
  
  /**
   * If platform-specific, which platform?
   */
  platform?: Platform;
  
  /**
   * Detected source platform ID (for $$source variable in flow conditions)
   * Defaults to 'openpackage' if universal format
   */
  sourcePlatform: string;
  
  /**
   * Confidence score (0-1) based on file analysis
   */
  confidence: number;
  
  /**
   * Detailed file analysis for debugging
   */
  analysis: FormatAnalysis;
  
  /**
   * Special flag: if true, content is already in native format for the target platform
   * (e.g., Claude plugin with Claude-format frontmatter)
   * This means: copy files with path mapping but skip content transformations
   */
  isNativeFormat?: boolean;
  
  /**
   * If isNativeFormat is true, which platform's format?
   */
  nativePlatform?: Platform;
}

export interface FormatAnalysis {
  universalFiles: number;
  platformSpecificFiles: number;
  detectedPlatforms: Map<Platform, number>;  // Platform -> file count
  totalFiles: number;
  samplePaths: {
    universal: string[];
    platformSpecific: string[];
  };
}

/**
 * Known universal subdirectories in OpenPackage format
 */
const UNIVERSAL_SUBDIRS = [
  'commands',
  'agents',
  'rules',
  'skills',
  'hooks'
];

/**
 * Known platform-specific root directories
 */
const PLATFORM_ROOT_DIRS: Record<string, Platform> = {
  '.claude': 'claude',
  '.claude-plugin': 'claude-plugin',
  '.cursor': 'cursor',
  '.opencode': 'opencode',
  '.codex': 'codex',
  '.factory': 'factory',
  '.kilocode': 'kilo',
  '.kiro': 'kiro',
  '.qwen': 'qwen',
  '.roo': 'roo',
  '.warp': 'warp',
  '.windsurf': 'windsurf',
  '.augment': 'augment',
  '.agent': 'antigravity'
};

/**
 * Detect package format from file list
 */
export function detectPackageFormat(files: PackageFile[]): PackageFormat {
  logger.debug('Detecting package format', { fileCount: files.length });
  
  // Check for claude-plugin first (highest priority)
  const hasClaudePluginManifest = files.some(f => 
    f.path === '.claude-plugin/plugin.json'
  );
  
  if (hasClaudePluginManifest) {
    logger.debug('Detected Claude Code plugin format');
    return {
      type: 'platform-specific',
      platform: 'claude-plugin',
      sourcePlatform: 'claude-plugin',
      confidence: 1.0,
      analysis: {
        universalFiles: 0,
        platformSpecificFiles: files.length,
        detectedPlatforms: new Map([['claude-plugin', files.length]]),
        totalFiles: files.length,
        samplePaths: {
          universal: [],
          platformSpecific: ['.claude-plugin/plugin.json']
        }
      },
      isNativeFormat: true,
      nativePlatform: 'claude'
    };
  }
  
  const analysis: FormatAnalysis = {
    universalFiles: 0,
    platformSpecificFiles: 0,
    detectedPlatforms: new Map(),
    totalFiles: files.length,
    samplePaths: {
      universal: [],
      platformSpecific: []
    }
  };
  
  // Analyze each file
  for (const file of files) {
    const classification = classifyFile(file.path);
    
    if (classification.type === 'universal') {
      analysis.universalFiles++;
      if (analysis.samplePaths.universal.length < 5) {
        analysis.samplePaths.universal.push(file.path);
      }
    } else if (classification.type === 'platform-specific' && classification.platform) {
      analysis.platformSpecificFiles++;
      const count = analysis.detectedPlatforms.get(classification.platform) || 0;
      analysis.detectedPlatforms.set(classification.platform, count + 1);
      
      if (analysis.samplePaths.platformSpecific.length < 5) {
        analysis.samplePaths.platformSpecific.push(file.path);
      }
    }
  }
  
  // Determine format based on analysis
  return determineFormat(analysis);
}

/**
 * Classify a single file path
 */
function classifyFile(path: string): {
  type: 'universal' | 'platform-specific' | 'other';
  platform?: Platform;
} {
  const parts = path.split('/');
  const firstPart = parts[0];
  
  // Check for platform-specific root directory
  if (firstPart in PLATFORM_ROOT_DIRS) {
    return {
      type: 'platform-specific',
      platform: PLATFORM_ROOT_DIRS[firstPart]
    };
  }
  
  // Check for universal subdirectory
  if (UNIVERSAL_SUBDIRS.includes(firstPart)) {
    return { type: 'universal' };
  }
  
  // Check for platform suffix in filename (e.g., mcp.claude.jsonc)
  const platformSuffix = extractPlatformSuffixFromPath(path);
  if (platformSuffix) {
    return {
      type: 'platform-specific',
      platform: platformSuffix
    };
  }
  
  // Root-level files or other directories
  return { type: 'other' };
}

/**
 * Extract platform suffix from filename (e.g., "mcp.claude.jsonc" -> "claude")
 */
function extractPlatformSuffixFromPath(path: string): Platform | null {
  const parts = path.split('/');
  const filename = parts[parts.length - 1];
  const nameParts = filename.split('.');
  
  // Need at least 3 parts: name.platform.ext
  if (nameParts.length >= 3) {
    const possiblePlatform = nameParts[nameParts.length - 2];
    if (isPlatformId(possiblePlatform)) {
      return possiblePlatform as Platform;
    }
  }
  
  return null;
}

/**
 * Determine overall format from analysis
 */
function determineFormat(analysis: FormatAnalysis): PackageFormat {
  const { universalFiles, platformSpecificFiles, detectedPlatforms, totalFiles } = analysis;
  
  // No files analyzed
  if (totalFiles === 0) {
    return {
      type: 'universal',
      sourcePlatform: 'openpackage',
      confidence: 0,
      analysis
    };
  }
  
  // Calculate ratios
  const universalRatio = universalFiles / totalFiles;
  const platformRatio = platformSpecificFiles / totalFiles;
  
  // Strong universal signal: >70% universal files
  if (universalRatio > 0.7) {
    logger.debug('Detected universal format', { 
      universalRatio, 
      universalFiles,
      samples: analysis.samplePaths.universal
    });
    
    return {
      type: 'universal',
      sourcePlatform: 'openpackage',
      confidence: universalRatio,
      analysis
    };
  }
  
  // Strong platform-specific signal: >70% platform files
  if (platformRatio > 0.7) {
    // Determine dominant platform
    let dominantPlatform: Platform | undefined;
    let maxCount = 0;
    
    for (const [platform, count] of detectedPlatforms) {
      if (count > maxCount) {
        maxCount = count;
        dominantPlatform = platform;
      }
    }
    
    if (dominantPlatform) {
      logger.debug('Detected platform-specific format', {
        platform: dominantPlatform,
        platformRatio,
        platformFiles: platformSpecificFiles,
        samples: analysis.samplePaths.platformSpecific
      });
      
      return {
        type: 'platform-specific',
        platform: dominantPlatform,
        sourcePlatform: dominantPlatform,
        confidence: platformRatio,
        analysis
      };
    }
  }
  
  // Mixed or unclear: default to universal with low confidence
  logger.debug('Mixed or unclear format, defaulting to universal', {
    universalRatio,
    platformRatio,
    detectedPlatforms: Array.from(detectedPlatforms.entries())
  });
  
  return {
    type: 'universal',
    sourcePlatform: 'openpackage',
    confidence: Math.max(universalRatio, 0.3),
    analysis
  };
}

/**
 * Check if a package format indicates platform-specific content
 */
export function isPlatformSpecific(format: PackageFormat): boolean {
  return format.type === 'platform-specific' && format.platform !== undefined;
}

/**
 * Check if conversion is needed for target platform
 */
export function needsConversion(
  format: PackageFormat,
  targetPlatform: Platform
): boolean {
  // Universal format always uses standard flows (no conversion)
  if (format.type === 'universal') {
    return false;
  }
  
  // Platform-specific: needs conversion if target differs from source
  if (format.type === 'platform-specific' && format.platform) {
    return format.platform !== targetPlatform;
  }
  
  return false;
}

/**
 * Check if package should install with path mapping only (no content transformations)
 * This applies to native format packages where the content is already correct for the
 * target platform, but file paths need to be mapped (e.g., commands/ → .claude/commands/)
 */
export function shouldUsePathMappingOnly(
  format: PackageFormat,
  targetPlatform: Platform
): boolean {
  // Native format for target platform: apply path mappings but skip content transforms
  return (
    format.isNativeFormat === true &&
    format.nativePlatform === targetPlatform
  );
}

/**
 * Check if package should install AS-IS (no transformations at all)
 * This is currently unused but kept for potential future use cases where
 * both structure AND content match exactly
 * 
 * @deprecated Use shouldUsePathMappingOnly instead for most cases
 */
export function shouldInstallDirectly(
  format: PackageFormat,
  targetPlatform: Platform
): boolean {
  // Platform-specific format matching target platform, but NOT native format
  // (native format needs path mapping)
  return (
    format.type === 'platform-specific' &&
    format.platform === targetPlatform &&
    !format.isNativeFormat
  );
}
