/**
 * Phase 6: Enhanced error messages for resource installation.
 * 
 * Provides helpful, actionable error messages with suggestions
 * for common failure scenarios.
 */

import { extractAllFromPatterns } from './pattern-matcher.js';

/**
 * Format an error message for when no pattern matches a resource path.
 * Provides helpful suggestions based on the path structure.
 * 
 * @param resourcePath - The path that didn't match
 * @param platformsConfig - Platforms configuration for pattern extraction
 * @returns Formatted error message with suggestions
 */
export function formatNoPatternMatchError(
  resourcePath: string,
  platformsConfig: any
): string {
  // Extract patterns from platforms config
  const patterns = extractAllFromPatterns(platformsConfig);
  const uniquePatterns = Array.from(new Set(patterns));
  
  // Analyze the path to provide specific suggestions
  const pathSegments = resourcePath.split('/').filter(s => s.length > 0);
  const suggestions: string[] = [];
  
  // Check if path contains common directory names
  if (pathSegments.some(s => s === 'agents' || s.includes('agent'))) {
    suggestions.push('• Did you mean to install an agent? Ensure your path follows the agents/**/*.md pattern');
  }
  
  if (pathSegments.some(s => s === 'skills' || s.includes('skill'))) {
    suggestions.push('• Did you mean to install a skill? Ensure your path follows the skills/**/* pattern');
  }
  
  if (pathSegments.some(s => s === 'rules' || s.includes('rule'))) {
    suggestions.push('• Did you mean to install a rule? Ensure your path follows the rules/**/*.md pattern');
  }
  
  if (pathSegments.some(s => s === 'commands' || s.includes('command'))) {
    suggestions.push('• Did you mean to install a command? Ensure your path follows the commands/**/*.md pattern');
  }
  
  // Build the error message
  let message = `Path '${resourcePath}' does not match any installable pattern.\n\n`;
  message += `Installable patterns include:\n`;
  
  // Show most common patterns first
  const commonPatterns = [
    'agents/**/*.md',
    'skills/**/*',
    'rules/**/*.md',
    'commands/**/*.md'
  ];
  
  for (const pattern of commonPatterns) {
    if (uniquePatterns.includes(pattern)) {
      message += `  • ${pattern}\n`;
    }
  }
  
  // Show other patterns if they exist
  const otherPatterns = uniquePatterns.filter(p => !commonPatterns.includes(p));
  if (otherPatterns.length > 0 && otherPatterns.length <= 5) {
    for (const pattern of otherPatterns) {
      message += `  • ${pattern}\n`;
    }
  } else if (otherPatterns.length > 5) {
    message += `  • ... and ${otherPatterns.length} more patterns\n`;
  }
  
  if (suggestions.length > 0) {
    message += `\n💡 Suggestions:\n`;
    message += suggestions.join('\n');
  }
  
  return message;
}

/**
 * Format an error message for when a resource is not found.
 * 
 * @param resourceName - Name of the resource
 * @param resourceType - Type of resource (agent, skill, etc.)
 * @param availableResources - List of available resources (if any)
 * @returns Formatted error message
 */
export function formatResourceNotFoundError(
  resourceName: string,
  resourceType: 'agent' | 'skill' | 'plugin',
  availableResources?: string[]
): string {
  let message = `${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)} '${resourceName}' not found.\n`;
  
  if (availableResources && availableResources.length > 0) {
    message += `\nAvailable ${resourceType}s:\n`;
    const sortedResources = [...availableResources].sort();
    for (const resource of sortedResources.slice(0, 10)) {
      message += `  • ${resource}\n`;
    }
    if (sortedResources.length > 10) {
      message += `  • ... and ${sortedResources.length - 10} more\n`;
    }
    
    // Try to find similar names
    const similar = findSimilarNames(resourceName, availableResources);
    if (similar.length > 0) {
      message += `\n💡 Did you mean:\n`;
      for (const name of similar.slice(0, 3)) {
        message += `  • ${name}\n`;
      }
    }
  }
  
  return message;
}

/**
 * Find names similar to the target name using simple string distance.
 * 
 * @param target - The target name to match
 * @param candidates - List of candidate names
 * @returns Array of similar names (up to 3)
 */
function findSimilarNames(target: string, candidates: string[]): string[] {
  const targetLower = target.toLowerCase();
  
  // Score each candidate
  const scored = candidates.map(candidate => ({
    name: candidate,
    score: calculateSimilarity(targetLower, candidate.toLowerCase())
  }));
  
  // Sort by score (higher is better)
  scored.sort((a, b) => b.score - a.score);
  
  // Return top matches with score > 0.5
  return scored
    .filter(s => s.score > 0.5)
    .slice(0, 3)
    .map(s => s.name);
}

/**
 * Calculate similarity between two strings.
 * Uses a simple character-based similarity metric.
 * 
 * @param a - First string
 * @param b - Second string
 * @returns Similarity score (0-1, higher is more similar)
 */
function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;
  
  // Check for substring match
  if (a.includes(b) || b.includes(a)) {
    return 0.8;
  }
  
  // Simple character overlap metric
  const aChars = new Set(a.split(''));
  const bChars = new Set(b.split(''));
  const overlap = [...aChars].filter(c => bChars.has(c)).length;
  const total = Math.max(aChars.size, bChars.size);
  
  return overlap / total;
}

/**
 * Format an error message for version specification on sub-paths.
 * 
 * @param input - The invalid input string
 * @returns Formatted error message with correct syntax
 */
export function formatVersionOnSubPathError(input: string): string {
  // Try to extract the parts to provide a corrected example
  const parts = input.split('@');
  let suggestion = '';
  
  if (parts.length >= 2) {
    // Assume format like: gh@owner/repo/path@version
    const beforeVersion = parts.slice(0, -1).join('@');
    const version = parts[parts.length - 1];
    const versionPart = version.split('/')[0];
    
    // Try to reconstruct: gh@owner/repo@version/path
    const segments = beforeVersion.split('/');
    if (segments.length >= 3) {
      suggestion = `\n\nDid you mean: ${segments.slice(0, 3).join('/')}@${versionPart}/${segments.slice(3).join('/')}`;
    }
  }
  
  let message = `Version cannot be specified on sub-paths.\n\n`;
  message += `Got: ${input}\n`;
  message += `Valid format: <package>[@version][/path]\n`;
  message += `Examples:\n`;
  message += `  • gh@owner/repo@v1.0.0/agents/designer.md\n`;
  message += `  • my-package@1.0.0/skills/git\n`;
  message += `  • @scope/package@2.0.0/agents/architect\n`;
  
  if (suggestion) {
    message += suggestion;
  }
  
  return message;
}


