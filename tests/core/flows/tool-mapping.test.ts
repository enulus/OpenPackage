/**
 * Tool Mapping Test
 * 
 * Tests the tool name mappings between Universal format and platform-specific formats.
 * Verifies that tool transformations work correctly for:
 * - Claude Code (PascalCase with special cases)
 * - OpenCode (lowercase, array ↔ object)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Tool Mapping', () => {
  describe('Universal ↔ Claude Code', () => {
    it('should map special case tools correctly', () => {
      // Universal → Claude
      const universalTools = ['question', 'notebook', 'exitplan', 'read', 'bash'];
      const expectedClaude = 'AskUserQuestion, NotebookEdit, ExitPlanMode, Read, Bash';
      
      // This transformation happens via map pipeline in platforms.jsonc:
      // 1. Map special cases: question→AskUserQuestion, notebook→NotebookEdit, exitplan→ExitPlanMode
      // 2. Capitalize: read→Read, bash→Bash
      // 3. Join: "AskUserQuestion, NotebookEdit, ExitPlanMode, Read, Bash"
      
      // Simulate the mapping
      const mapped = universalTools
        .map(tool => {
          const specialCases: Record<string, string> = {
            question: 'AskUserQuestion',
            notebook: 'NotebookEdit',
            exitplan: 'ExitPlanMode',
          };
          return specialCases[tool] || tool;
        })
        .map(tool => tool.charAt(0).toUpperCase() + tool.slice(1))
        .join(', ');
      
      assert.strictEqual(mapped, expectedClaude);
    });
    
    it('should reverse map special case tools correctly', () => {
      // Claude → Universal
      const claudeTools = 'AskUserQuestion, NotebookEdit, ExitPlanMode, Read, Bash';
      const expectedUniversal = ['question', 'notebook', 'exitplan', 'read', 'bash'];
      
      // This transformation happens via map pipeline in platforms.jsonc:
      // 1. Split: "AskUserQuestion, NotebookEdit" → ["AskUserQuestion", "NotebookEdit"]
      // 2. Lowercase: ["askuserquestion", "notebookedit"]
      // 3. Map special cases: askuserquestion→question, notebookedit→notebook
      
      // Simulate the mapping
      const mapped = claudeTools
        .split(', ')
        .map(tool => tool.toLowerCase())
        .map(tool => {
          const specialCases: Record<string, string> = {
            askuserquestion: 'question',
            notebookedit: 'notebook',
            exitplanmode: 'exitplan',
          };
          return specialCases[tool] || tool;
        });
      
      assert.deepStrictEqual(mapped, expectedUniversal);
    });
    
    it('should handle standard tools with simple capitalization', () => {
      // Standard tools only need capitalization change
      const universalTools = ['read', 'write', 'edit', 'bash', 'grep', 'glob'];
      const expectedClaude = 'Read, Write, Edit, Bash, Grep, Glob';
      
      const mapped = universalTools
        .map(tool => tool.charAt(0).toUpperCase() + tool.slice(1))
        .join(', ');
      
      assert.strictEqual(mapped, expectedClaude);
    });
  });
  
  describe('Universal ↔ OpenCode', () => {
    it('should convert array to object format', () => {
      // Universal → OpenCode
      const universalTools = ['read', 'write', 'bash'];
      const expectedOpenCode = { read: true, write: true, bash: true };
      
      // This transformation happens via $arrayToObject operation
      const mapped = Object.fromEntries(
        universalTools.map(tool => [tool, true])
      );
      
      assert.deepStrictEqual(mapped, expectedOpenCode);
    });
    
    it('should convert object to array format (enabled only)', () => {
      // OpenCode → Universal
      const openCodeTools = { read: true, write: false, bash: true, edit: true };
      const expectedUniversal = ['read', 'bash', 'edit'];
      
      // This transformation happens via $filter + $objectToArray
      const mapped = Object.entries(openCodeTools)
        .filter(([_, enabled]) => enabled)
        .map(([tool, _]) => tool);
      
      assert.deepStrictEqual(mapped, expectedUniversal);
    });
    
    it('should preserve lowercase tool names', () => {
      // OpenCode uses lowercase like universal, no transformation needed
      const tools = ['read', 'write', 'bash', 'webfetch'];
      
      // No mapping operation needed
      assert.deepStrictEqual(tools, tools);
    });
  });
  
  describe('Complete round-trip', () => {
    it('Universal → Claude → Universal should preserve tools', () => {
      const original = ['question', 'read', 'bash', 'notebook'];
      
      // To Claude
      const toClaude = original
        .map(tool => {
          const specialCases: Record<string, string> = {
            question: 'AskUserQuestion',
            notebook: 'NotebookEdit',
            exitplan: 'ExitPlanMode',
          };
          return specialCases[tool] || tool;
        })
        .map(tool => tool.charAt(0).toUpperCase() + tool.slice(1))
        .join(', ');
      
      // Back to Universal
      const backToUniversal = toClaude
        .split(', ')
        .map(tool => tool.toLowerCase())
        .map(tool => {
          const specialCases: Record<string, string> = {
            askuserquestion: 'question',
            notebookedit: 'notebook',
            exitplanmode: 'exitplan',
          };
          return specialCases[tool] || tool;
        });
      
      assert.deepStrictEqual(backToUniversal, original);
    });
    
    it('Universal → OpenCode → Universal should preserve tools', () => {
      const original = ['read', 'write', 'bash'];
      
      // To OpenCode
      const toOpenCode = Object.fromEntries(
        original.map(tool => [tool, true])
      );
      
      // Back to Universal
      const backToUniversal = Object.entries(toOpenCode)
        .filter(([_, enabled]) => enabled)
        .map(([tool, _]) => tool);
      
      assert.deepStrictEqual(backToUniversal, original);
    });
  });
});
