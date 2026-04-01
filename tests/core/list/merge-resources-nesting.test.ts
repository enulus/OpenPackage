/**
 * Unit tests for mergeTrackedAndUntrackedResources tree vs flat mode.
 *
 * Verifies that:
 * - Dependencies are shown as flat reference entries, not nested subtrees
 * - Embedded children's resources fold into the parent container
 * - Missing packages appear with status 'missing'
 * - Both tree and flat modes produce consistent non-nested output
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeTrackedAndUntrackedResources } from '../../../packages/core/src/core/list/scope-data-collector.js';
import type { ListTreeNode, ListPackageReport, ListResourceGroup } from '../../../packages/core/src/core/list/list-pipeline.js';
import type { InstallScope } from '../../../packages/core/src/types/workspace-index.js';

function makeReport(
  name: string,
  opts?: {
    installScope?: InstallScope;
    isEmbedded?: boolean;
    state?: 'synced' | 'partial' | 'missing';
    resourceGroups?: ListResourceGroup[];
    namespace?: string;
  }
): ListPackageReport {
  return {
    name,
    path: `/fake/${name}`,
    state: opts?.state ?? 'synced',
    totalFiles: 1,
    existingFiles: 1,
    installScope: opts?.installScope ?? 'full',
    isEmbedded: opts?.isEmbedded,
    resourceGroups: opts?.resourceGroups,
    namespace: opts?.namespace,
  };
}

function makeResourceGroup(type: string, resourceNames: string[]): ListResourceGroup {
  return {
    resourceType: type,
    resources: resourceNames.map(n => ({
      name: n,
      resourceType: type,
      files: [{ source: `/src/${n}`, target: `${type}/${n}`, exists: true }],
    })),
  };
}

function makeNode(
  name: string,
  children: ListTreeNode[] = [],
  opts?: Parameters<typeof makeReport>[1]
): ListTreeNode {
  return { report: makeReport(name, opts), children };
}

function findByName(items: Array<{ name: string; children?: Array<{ name: string; children?: any[] }> }>, namePart: string): any | undefined {
  for (const item of items) {
    if (item.name.includes(namePart)) return item;
    if (item.children) {
      const found = findByName(item.children, namePart);
      if (found) return found;
    }
  }
  return undefined;
}

function findContainer(groups: ReturnType<typeof mergeTrackedAndUntrackedResources>, namePart: string) {
  for (const g of groups) {
    const found = findByName(g.resources, namePart);
    if (found) return found;
  }
  return undefined;
}

function getPackagesGroup(groups: ReturnType<typeof mergeTrackedAndUntrackedResources>) {
  return groups.find(g => g.resourceType === 'packages');
}

describe('mergeTrackedAndUntrackedResources nesting', () => {
  describe('tree mode (flat=false)', () => {
    it('shows dependency as a reference, not a nested container', () => {
      // pkg-a depends on pkg-b (non-embedded)
      const pkgB = makeNode('pkg-b', [], {
        installScope: 'full',
        resourceGroups: [makeResourceGroup('skills', ['skill-b'])],
      });
      const pkgA = makeNode('pkg-a', [pkgB], {
        installScope: 'full',
        resourceGroups: [makeResourceGroup('rules', ['rule-a'])],
      });

      const result = mergeTrackedAndUntrackedResources([pkgA], undefined, 'project', undefined, false);
      const pkgGroup = getPackagesGroup(result);
      assert.ok(pkgGroup, 'Should have a packages group');
      assert.equal(pkgGroup!.resources.length, 2, 'pkg-a and pkg-b both at root level');

      const containerA = pkgGroup!.resources.find(r => r.name.includes('pkg-a'));
      assert.ok(containerA, 'Root container should include pkg-a');
      assert.ok(containerA!.children, 'pkg-a should have children');

      // pkg-b should be a dependency reference under pkg-a
      const depRef = containerA!.children!.find(c => c.name === 'pkg-b');
      assert.ok(depRef, 'pkg-b should appear as a dependency reference under pkg-a');
      assert.equal(depRef!.isDependencyRef, true, 'Should be marked as dependency reference');

      // pkg-b should ALSO appear as its own top-level container
      const containerB = pkgGroup!.resources.find(r => r.name.includes('pkg-b'));
      assert.ok(containerB, 'pkg-b should also appear as its own top-level entry');
      assert.equal(containerB!.isDependencyRef, undefined, 'Top-level pkg-b is not a dep ref');

      // own resource should still be present
      const ruleA = containerA!.children!.find(c => c.name === 'rule-a');
      assert.ok(ruleA, 'rule-a should be a direct child of pkg-a');
    });

    it('shows transitive deps as flat references (A -> B -> C)', () => {
      const pkgC = makeNode('pkg-c', [], {
        installScope: 'full',
        resourceGroups: [makeResourceGroup('agents', ['agent-c'])],
      });
      const pkgB = makeNode('pkg-b', [pkgC], {
        installScope: 'full',
        resourceGroups: [makeResourceGroup('skills', ['skill-b'])],
      });
      const pkgA = makeNode('pkg-a', [pkgB], {
        installScope: 'full',
        resourceGroups: [makeResourceGroup('rules', ['rule-a'])],
      });

      const result = mergeTrackedAndUntrackedResources([pkgA], undefined, 'project', undefined, false);
      const pkgGroup = getPackagesGroup(result);
      assert.ok(pkgGroup);
      assert.equal(pkgGroup!.resources.length, 3, 'pkg-a, pkg-b, pkg-c all at root');

      const containerA = pkgGroup!.resources.find(r => r.name.includes('pkg-a'));
      assert.ok(containerA);

      // pkg-b should be a dep ref under pkg-a
      const depRefB = containerA!.children!.find(c => c.name === 'pkg-b');
      assert.ok(depRefB, 'pkg-b should be a dep ref under pkg-a');
      assert.equal(depRefB!.isDependencyRef, true);

      // pkg-c should NOT appear inside pkg-a (it's a transitive dep of pkg-b, not pkg-a)
      const depRefC = containerA!.children!.find(c => c.name === 'pkg-c');
      assert.equal(depRefC, undefined, 'pkg-c should NOT appear in pkg-a (transitive)');

      // But pkg-b and pkg-c should appear as their own top-level entries
      const containerB = pkgGroup!.resources.find(r => r.name.includes('pkg-b'));
      assert.ok(containerB, 'pkg-b should be its own top-level entry');
      const containerC = pkgGroup!.resources.find(r => r.name.includes('pkg-c'));
      assert.ok(containerC, 'pkg-c should be its own top-level entry');
    });

    it('marks missing package dependency as reference', () => {
      const pkgB = makeNode('pkg-b', [], {
        installScope: 'full',
        state: 'missing',
      });
      const pkgA = makeNode('pkg-a', [pkgB], {
        installScope: 'full',
        resourceGroups: [makeResourceGroup('rules', ['rule-a'])],
      });

      const result = mergeTrackedAndUntrackedResources([pkgA], undefined, 'project', undefined, false);
      const pkgGroup = getPackagesGroup(result);
      assert.ok(pkgGroup);

      const containerA = pkgGroup!.resources[0];
      // Missing dep still appears as a reference
      const depRef = containerA.children!.find(c => c.name === 'pkg-b');
      assert.ok(depRef, 'Missing pkg-b should appear as dep ref');
      assert.equal(depRef!.isDependencyRef, true);
    });

    it('folds embedded children into parent, shows non-embedded as dep ref', () => {
      const embeddedD = makeNode('pkg-d', [], {
        installScope: 'full',
        isEmbedded: true,
        resourceGroups: [makeResourceGroup('skills', ['skill-d'])],
      });
      const depB = makeNode('pkg-b', [], {
        installScope: 'full',
        resourceGroups: [makeResourceGroup('skills', ['skill-b'])],
      });
      const pkgA = makeNode('pkg-a', [embeddedD, depB], {
        installScope: 'full',
        resourceGroups: [makeResourceGroup('rules', ['rule-a'])],
      });

      const result = mergeTrackedAndUntrackedResources([pkgA], undefined, 'project', undefined, false);
      const pkgGroup = getPackagesGroup(result);
      assert.ok(pkgGroup);
      assert.equal(pkgGroup!.resources.length, 2, 'pkg-a and pkg-b at root (embedded pkg-d folded)');

      const containerA = pkgGroup!.resources.find(r => r.name.includes('pkg-a'));
      assert.ok(containerA);

      // skill-d from embedded pkg-d should be folded into pkg-a's own children
      const skillD = containerA!.children!.find(c => c.name === 'skill-d');
      assert.ok(skillD, 'Embedded skill-d should be folded into pkg-a');

      // pkg-b should be a dep ref under pkg-a
      const depRef = containerA!.children!.find(c => c.name === 'pkg-b');
      assert.ok(depRef, 'Non-embedded pkg-b should be a dep ref');
      assert.equal(depRef!.isDependencyRef, true);

      // pkg-b should ALSO appear as its own top-level entry
      const containerB = pkgGroup!.resources.find(r => r.name.includes('pkg-b'));
      assert.ok(containerB, 'pkg-b should also be its own top-level entry');

      // embedded pkg-d should NOT appear at root (it's folded into pkg-a)
      const containerD = pkgGroup!.resources.find(r => r.name.includes('pkg-d'));
      assert.equal(containerD, undefined, 'Embedded pkg-d should not appear at root');
    });
  });

  describe('flat mode (flat=true)', () => {
    it('places package at root with dep refs', () => {
      const pkgB = makeNode('pkg-b', [], {
        installScope: 'full',
        resourceGroups: [makeResourceGroup('skills', ['skill-b'])],
      });
      const pkgA = makeNode('pkg-a', [pkgB], {
        installScope: 'full',
        resourceGroups: [makeResourceGroup('rules', ['rule-a'])],
      });

      const result = mergeTrackedAndUntrackedResources([pkgA], undefined, 'project', undefined, true);
      const pkgGroup = getPackagesGroup(result);
      assert.ok(pkgGroup, 'Should have a packages group');
      assert.equal(pkgGroup!.resources.length, 1, 'Only pkg-a (dep children not expanded)');

      const containerA = pkgGroup!.resources.find(r => r.name.includes('pkg-a'));
      assert.ok(containerA, 'pkg-a should be at root');

      // pkg-b should be a dep ref inside pkg-a, not a separate root container
      const depRef = containerA!.children?.find(c => c.name === 'pkg-b');
      assert.ok(depRef, 'pkg-b should be a dep ref');
      assert.equal(depRef!.isDependencyRef, true);
    });

    it('shows missing containers as dep refs in flat mode', () => {
      const pkgB = makeNode('pkg-b', [], {
        installScope: 'full',
        state: 'missing',
      });
      const pkgA = makeNode('pkg-a', [pkgB], {
        installScope: 'full',
        resourceGroups: [makeResourceGroup('rules', ['rule-a'])],
      });

      const result = mergeTrackedAndUntrackedResources([pkgA], undefined, 'project', undefined, true);
      const pkgGroup = getPackagesGroup(result);
      assert.ok(pkgGroup);

      const containerA = pkgGroup!.resources.find(r => r.name.includes('pkg-a'));
      assert.ok(containerA);

      const depRef = containerA!.children?.find(c => c.name === 'pkg-b');
      assert.ok(depRef, 'Missing pkg-b should appear as dep ref');
      assert.equal(depRef!.isDependencyRef, true);
    });
  });
});
