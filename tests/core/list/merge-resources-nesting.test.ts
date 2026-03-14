/**
 * Unit tests for mergeTrackedAndUntrackedResources tree vs flat mode.
 *
 * Verifies that:
 * - Tree mode nests child containers inside parent containers
 * - Flat mode places all containers at root level
 * - Missing packages appear with status 'missing'
 * - Embedded children's resources fold into the parent container
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
    it('nests child container inside parent container', () => {
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
      assert.equal(pkgGroup!.resources.length, 1, 'Only pkg-a at root level');

      const containerA = pkgGroup!.resources[0];
      assert.ok(containerA.name.includes('pkg-a'), 'Root container should be pkg-a');
      assert.ok(containerA.children, 'pkg-a should have children');

      // pkg-a children: rule-a (own resource) + pkg-b (nested container)
      const nestedB = containerA.children!.find(c => c.name.includes('pkg-b'));
      assert.ok(nestedB, 'pkg-b should be nested inside pkg-a');
      assert.ok(nestedB!.children, 'pkg-b should have children (its resources)');

      const skillB = nestedB!.children!.find(c => c.name === 'skill-b');
      assert.ok(skillB, 'skill-b should be inside pkg-b container');
    });

    it('preserves three-level nesting: A -> B -> C', () => {
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
      assert.equal(pkgGroup!.resources.length, 1, 'Only pkg-a at root');

      const containerA = pkgGroup!.resources[0];
      const nestedB = containerA.children!.find(c => c.name.includes('pkg-b'));
      assert.ok(nestedB, 'pkg-b nested in pkg-a');

      const nestedC = nestedB!.children!.find(c => c.name.includes('pkg-c'));
      assert.ok(nestedC, 'pkg-c nested in pkg-b');

      const agentC = nestedC!.children!.find(c => c.name === 'agent-c');
      assert.ok(agentC, 'agent-c inside pkg-c');
    });

    it('marks missing package with status missing', () => {
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
      const nestedB = containerA.children!.find(c => c.name.includes('pkg-b'));
      assert.ok(nestedB, 'Missing pkg-b should still appear');
      assert.equal(nestedB!.status, 'missing', 'Missing container should have status=missing');
    });

    it('folds embedded children into parent, nests non-embedded as sub-container', () => {
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
      assert.equal(pkgGroup!.resources.length, 1, 'Only pkg-a at root');

      const containerA = pkgGroup!.resources[0];

      // skill-d from embedded pkg-d should be folded into pkg-a's own children
      const skillD = containerA.children!.find(c => c.name === 'skill-d');
      assert.ok(skillD, 'Embedded skill-d should be folded into pkg-a');

      // pkg-b should be a nested sub-container
      const nestedB = containerA.children!.find(c => c.name.includes('pkg-b'));
      assert.ok(nestedB, 'Non-embedded pkg-b should be nested container');
      assert.ok(nestedB!.children, 'pkg-b should have children');
    });
  });

  describe('flat mode (flat=true)', () => {
    it('places all containers at root level', () => {
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
      assert.equal(pkgGroup!.resources.length, 2, 'Both pkg-a and pkg-b at root level');

      const containerA = pkgGroup!.resources.find(r => r.name.includes('pkg-a'));
      const containerB = pkgGroup!.resources.find(r => r.name.includes('pkg-b'));
      assert.ok(containerA, 'pkg-a should be at root');
      assert.ok(containerB, 'pkg-b should be at root');

      // pkg-a should NOT contain pkg-b as a nested child
      const nestedB = containerA!.children?.find(c => c.name.includes('pkg-b'));
      assert.equal(nestedB, undefined, 'pkg-b should NOT be nested in pkg-a in flat mode');
    });

    it('shows missing containers at root level in flat mode', () => {
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

      const containerB = pkgGroup!.resources.find(r => r.name.includes('pkg-b'));
      assert.ok(containerB, 'Missing pkg-b should appear at root in flat mode');
      assert.equal(containerB!.status, 'missing');
    });
  });
});
