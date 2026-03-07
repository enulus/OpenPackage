/**
 * Unit tests for printDepsView workspace root name filtering.
 *
 * Verifies that workspace root names from ALL scopes are excluded from
 * the dependency tree — not just the project scope's workspace name.
 */

import assert from 'node:assert/strict';
import { printDepsView } from '../../../packages/core/src/core/list/list-printers.js';
import type { ScopeResult } from '../../../packages/core/src/core/list/scope-data-collector.js';
import type { ListTreeNode, ListPackageReport } from '../../../packages/core/src/core/list/list-pipeline.js';
import type { ResourceScope } from '../../../packages/core/src/core/resources/scope-traversal.js';
import type { OutputPort } from '../../../packages/core/src/core/ports/output.js';

function makeReport(name: string): ListPackageReport {
  return {
    name,
    path: `/fake/${name}`,
    state: 'synced',
    totalFiles: 1,
    existingFiles: 1,
  };
}

function makeNode(name: string, children: ListTreeNode[] = []): ListTreeNode {
  return { report: makeReport(name), children };
}

function makeScopeResult(headerName: string, headerType: 'workspace' | 'package' | 'resource', tree: ListTreeNode[]): ScopeResult {
  return {
    headerName,
    headerVersion: undefined,
    headerPath: `/fake/${headerName}`,
    headerType,
    tree,
    data: {
      packages: [],
      trackedCount: 0,
      missingCount: 0,
      untrackedCount: 0,
    },
  };
}

function captureOutput(): { lines: string[]; port: OutputPort } {
  const lines: string[] = [];
  return {
    lines,
    port: {
      info: (msg: string) => { lines.push(msg); },
      warn: (msg: string) => { lines.push(msg); },
      error: (msg: string) => { lines.push(msg); },
    },
  };
}

// Bug repro: global workspace name should NOT appear as a dependency
{
  const projectResult = makeScopeResult('opkg-cli', 'workspace', [
    makeNode('opkg-cli', [makeNode('git'), makeNode('openpackage')]),
    makeNode('openpackage'),
  ]);

  const globalResult = makeScopeResult('hyericlee', 'workspace', [
    makeNode('hyericlee', [makeNode('git'), makeNode('openpackage')]),
    makeNode('git'),
    makeNode('openpackage'),
  ]);

  const results: Array<{ scope: ResourceScope; result: ScopeResult }> = [
    { scope: 'project', result: projectResult },
    { scope: 'global', result: globalResult },
  ];

  const headerInfo = { name: 'opkg-cli', path: '/fake/opkg-cli', type: 'workspace' as const };
  const { lines, port } = captureOutput();

  printDepsView(results, false, headerInfo, port);

  // Tree lines use connector characters (├── or └──)
  const treeLines = lines.filter(l => l.includes('──'));
  const treeText = treeLines.join('\n');
  assert.ok(!treeText.includes('hyericlee'), 'Global workspace name "hyericlee" should not appear in dependency tree');
  assert.ok(!treeText.includes('opkg-cli'), 'Project workspace name "opkg-cli" should not appear as a dependency entry');
  assert.ok(treeText.includes('git'), 'Real dependency "git" should appear');
  assert.ok(treeText.includes('openpackage'), 'Real dependency "openpackage" should appear');
  console.log('✓ Workspace root names from all scopes are excluded from dependency tree');
}

// Verify dependency count is correct after filtering
{
  const projectResult = makeScopeResult('my-project', 'workspace', [
    makeNode('my-project'),
    makeNode('dep-a'),
  ]);

  const globalResult = makeScopeResult('my-user', 'workspace', [
    makeNode('my-user'),
    makeNode('dep-b'),
  ]);

  const results: Array<{ scope: ResourceScope; result: ScopeResult }> = [
    { scope: 'project', result: projectResult },
    { scope: 'global', result: globalResult },
  ];

  const headerInfo = { name: 'my-project', path: '/fake/my-project', type: 'workspace' as const };
  const { lines, port } = captureOutput();

  printDepsView(results, false, headerInfo, port);

  const countLine = lines.find(l => l.includes('Dependencies'));
  assert.ok(countLine, 'Should have a Dependencies section header');
  assert.ok(countLine!.includes('(2)'), `Dependency count should be 2, got: ${countLine}`);
  console.log('✓ Dependency count is correct after filtering workspace roots');
}

console.log('\nAll printDepsView tests passed.');
