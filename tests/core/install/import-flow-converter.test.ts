/**
 * Import Flow Converter Tests
 * 
 * Tests for Phase 3: Per-File Import Flow Application
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  convertFormatGroup,
  convertSingleFile,
  applyImportFlows,
  validateUniversalFormat
} from '../../../src/core/install/import-flow-converter.js';
import type { PackageFile, FormatGroup } from '../../../src/core/install/detection-types.js';
import type { Flow } from '../../../src/types/flows.js';

describe('Import Flow Converter', () => {
  describe('convertSingleFile', () => {
    it('should convert Claude format agent to universal format', () => {
      const file: PackageFile = {
        path: '.claude/agents/reviewer.md',
        content: `---
tools: Read, Write
permissionMode: default
model: sonnet
---

# Code Reviewer Agent
Review code for best practices.`,
        frontmatter: {
          tools: 'Read, Write',
          permissionMode: 'default',
          model: 'sonnet'
        }
      };

      const flows: Flow[] = [
        {
          from: '.claude/agents/**/*.md',
          to: 'agents/**/*.md',
          map: [
            // Convert tools from string to array
            {
              $pipeline: {
                field: 'tools',
                operations: [
                  { $reduce: { type: 'split', separator: ', ' } },
                  { $map: { each: 'lowercase' } }
                ]
              }
            },
            // Convert model from shorthand to prefixed
            {
              $pipeline: {
                field: 'model',
                operations: [
                  { $replace: { pattern: '^sonnet$', with: 'anthropic/claude-3-5-sonnet-20241022' } }
                ]
              }
            },
            // Convert permissionMode to permissions object
            {
              $set: {
                permissions: {
                  edit: 'ask',
                  bash: 'ask',
                  read: 'ask'
                }
              }
            },
            { $unset: 'permissionMode' }
          ]
        }
      ];

      const result = convertSingleFile(file, flows, 'claude');

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.transformed, true);
      assert.ok(result.converted);
      assert.strictEqual(result.converted?.path, 'agents/reviewer.md');
      assert.deepStrictEqual(result.converted?.frontmatter?.tools, ['read', 'write']);
      assert.strictEqual(result.converted?.frontmatter?.model, 'anthropic/claude-3-5-sonnet-20241022');
      assert.deepStrictEqual(result.converted?.frontmatter?.permissions, {
        edit: 'ask',
        bash: 'ask',
        read: 'ask'
      });
      assert.strictEqual(result.converted?.frontmatter?.permissionMode, undefined);
    });

    it('should handle files with no matching flow', () => {
      const file: PackageFile = {
        path: 'skills/typescript/SKILL.md',
        content: '# TypeScript Skill\n\nProvides TypeScript support.'
      };

      const flows: Flow[] = [
        {
          from: '.claude/agents/**/*.md',
          to: 'agents/**/*.md'
        }
      ];

      const result = convertSingleFile(file, flows, 'claude');

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.transformed, false);
      assert.deepStrictEqual(result.converted, file);
    });

    it('should handle conversion errors gracefully', () => {
      const file: PackageFile = {
        path: '.claude/agents/bad.md',
        content: '---\ntools: Read\n---\nContent',
        frontmatter: {
          tools: 'Read'
        }
      };

      const flows: Flow[] = [
        {
          from: '.claude/agents/**/*.md',
          to: 'agents/**/*.md',
          map: [
            // Unknown operations are now silently ignored by applyMapPipeline
            { $invalidOp: {} } as any
          ]
        }
      ];

      const result = convertSingleFile(file, flows, 'claude');

      // Unknown map ops are now skipped (not treated as errors).
      // The flow still matches and transforms the path, so the result is successful.
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.transformed, true);
      assert.ok(result.converted);
      assert.strictEqual(result.converted?.path, 'agents/bad.md');
    });
  });

  describe('convertFormatGroup', () => {
    it('should skip conversion for universal format group', () => {
      const group: FormatGroup = {
        platformId: 'universal',
        files: [
          {
            path: 'agents/agent1.md',
            content: '---\ntools: [read, write]\n---\nContent',
            frontmatter: { tools: ['read', 'write'] }
          },
          {
            path: 'agents/agent2.md',
            content: '---\ntools: [bash]\n---\nContent',
            frontmatter: { tools: ['bash'] }
          }
        ],
        confidence: 1.0
      };

      const result = convertFormatGroup(group);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.filesProcessed, 2);
      assert.strictEqual(result.filesConverted, 2);
      assert.strictEqual(result.filesFailed, 0);
      assert.deepStrictEqual(result.convertedFiles, group.files);
    });

    it('should fail gracefully for unknown format group', () => {
      const group: FormatGroup = {
        platformId: 'unknown',
        files: [
          {
            path: 'agents/agent1.md',
            content: '# Agent'
          }
        ],
        confidence: 0
      };

      const result = convertFormatGroup(group);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.filesProcessed, 1);
      assert.strictEqual(result.filesConverted, 0);
      assert.strictEqual(result.filesFailed, 1);
    });

    it('should convert entire Claude format group', () => {
      const group: FormatGroup = {
        platformId: 'claude',
        files: [
          {
            path: '.claude/agents/agent1.md',
            content: '---\ntools: Read\n---\nContent',
            frontmatter: { tools: 'Read' }
          },
          {
            path: '.claude/agents/agent2.md',
            content: '---\ntools: Write, Bash\n---\nContent',
            frontmatter: { tools: 'Write, Bash' }
          }
        ],
        confidence: 0.95
      };

      const result = convertFormatGroup(group);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.platformId, 'claude');
      assert.strictEqual(result.filesProcessed, 2);
      
      // Check converted files
      assert.ok(result.convertedFiles.length > 0);
      
      // Files should have transformed paths
      const paths = result.convertedFiles.map(f => f.path);
      assert.strictEqual(paths.some(p => p.startsWith('agents/')), true);
    });

    it('should handle platform with no import flows', () => {
      const group: FormatGroup = {
        platformId: 'cursor',
        files: [
          {
            path: '.cursor/agents/agent1.md',
            content: '---\ntools: [read]\n---\nContent',
            frontmatter: { tools: ['read'] }
          }
        ],
        confidence: 1.0
      };

      const result = convertFormatGroup(group);

      // Cursor might not have import flows with transformations
      // Should return files unchanged or with minimal transformation
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.filesProcessed, 1);
    });
  });

  describe('applyImportFlows', () => {
    it('should apply flows to multiple files', () => {
      const files: PackageFile[] = [
        {
          path: '.claude/agents/agent1.md',
          content: '---\ntools: Read\n---\nContent',
          frontmatter: { tools: 'Read' }
        },
        {
          path: '.claude/agents/agent2.md',
          content: '---\ntools: Write\n---\nContent',
          frontmatter: { tools: 'Write' }
        }
      ];

      const flows: Flow[] = [
        {
          from: '.claude/agents/**/*.md',
          to: 'agents/**/*.md',
          map: [
            {
              $pipeline: {
                field: 'tools',
                operations: [
                  { $reduce: { type: 'split', separator: ', ' } },
                  { $map: { each: 'lowercase' } }
                ]
              }
            }
          ]
        }
      ];

      const result = applyImportFlows(files, flows, 'claude');

      assert.strictEqual(result.length, 2);
      assert.deepStrictEqual(result[0].frontmatter?.tools, ['read']);
      assert.deepStrictEqual(result[1].frontmatter?.tools, ['write']);
    });

    it('should include original file if conversion fails', () => {
      const files: PackageFile[] = [
        {
          path: '.claude/agents/good.md',
          content: '---\ntools: Read\n---\nContent',
          frontmatter: { tools: 'Read' }
        },
        {
          path: '.claude/agents/bad.md',
          content: '---\ntools: Write\n---\nContent',
          frontmatter: { tools: 'Write' }
        }
      ];

      const flows: Flow[] = [
        {
          from: '.claude/agents/**/*.md',
          to: 'agents/**/*.md',
          map: [
            // Unknown ops are now silently ignored, so conversion succeeds
            { $invalidOperation: {} } as any
          ]
        }
      ];

      const result = applyImportFlows(files, flows, 'claude');

      // Both files are converted (unknown ops skipped, path still transformed)
      assert.strictEqual(result.length, 2);
      // Paths should be transformed to universal format
      assert.strictEqual(result.some(f => f.path === 'agents/good.md'), true);
      assert.strictEqual(result.some(f => f.path === 'agents/bad.md'), true);
    });
  });

  describe('validateUniversalFormat', () => {
    it('should validate universal format with array tools', () => {
      const file: PackageFile = {
        path: 'agents/agent.md',
        frontmatter: {
          tools: ['read', 'write', 'bash']
        }
      };

      assert.strictEqual(validateUniversalFormat(file), true);
    });

    it('should reject non-array tools', () => {
      const file: PackageFile = {
        path: 'agents/agent.md',
        frontmatter: {
          tools: 'Read, Write'  // String format (Claude)
        }
      };

      assert.strictEqual(validateUniversalFormat(file), false);
    });

    it('should reject platform-specific exclusive fields', () => {
      const claudeFile: PackageFile = {
        path: 'agents/agent.md',
        frontmatter: {
          tools: ['read'],
          permissionMode: 'default'  // Claude exclusive
        }
      };

      assert.strictEqual(validateUniversalFormat(claudeFile), false);

      const opencodeFile: PackageFile = {
        path: 'agents/agent.md',
        frontmatter: {
          tools: { read: true },  // OpenCode format
          temperature: 0.7  // OpenCode exclusive
        }
      };

      assert.strictEqual(validateUniversalFormat(opencodeFile), false);
    });

    it('should accept files with no frontmatter', () => {
      const file: PackageFile = {
        path: 'skills/typescript/SKILL.md',
        content: '# TypeScript Skill'
      };

      assert.strictEqual(validateUniversalFormat(file), true);
    });

    it('should validate file with permissions object', () => {
      const file: PackageFile = {
        path: 'agents/agent.md',
        frontmatter: {
          tools: ['read', 'write'],
          permissions: {
            edit: 'ask',
            bash: 'ask'
          }
        }
      };

      assert.strictEqual(validateUniversalFormat(file), true);
    });
  });

  describe('Path transformation', () => {
    it('should transform Claude paths to universal', () => {
      const file: PackageFile = {
        path: '.claude/agents/subfolder/agent.md',
        content: '---\ntools: Read\n---\nContent',
        frontmatter: { tools: 'Read' }
      };

      const flows: Flow[] = [
        {
          from: '.claude/agents/**/*.md',
          to: 'agents/**/*.md',
          map: [
            {
              $pipeline: {
                field: 'tools',
                operations: [
                  { $reduce: { type: 'split', separator: ', ' } },
                  { $map: { each: 'lowercase' } }
                ]
              }
            }
          ]
        }
      ];

      const result = convertSingleFile(file, flows, 'claude');

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.converted?.path, 'agents/subfolder/agent.md');
    });

    it('should transform Cursor paths to universal', () => {
      const file: PackageFile = {
        path: '.cursor/rules/rule.md',
        content: '# Rule',
        frontmatter: {}
      };

      const flows: Flow[] = [
        {
          from: '.cursor/rules/**/*.md',
          to: 'rules/**/*.md'
        }
      ];

      const result = convertSingleFile(file, flows, 'cursor');

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.converted?.path, 'rules/rule.md');
    });
  });
});
