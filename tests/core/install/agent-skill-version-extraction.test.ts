/**
 * Test: Agent and Skill Version Extraction
 * 
 * Verifies that agents and skills can have individual versions extracted
 * from their frontmatter, and that the fallback chain works correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { applyConvenienceFilters } from '../../../src/core/install/convenience-matchers.js';

describe('Agent and Skill Version Extraction', () => {
  let tempDir: string;
  let repoRoot: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    repoRoot = tempDir;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Agent version extraction', () => {
    it('should extract version from agent frontmatter when present', async () => {
      // Create agents directory with versioned agent
      const agentsDir = join(tempDir, 'agents');
      await mkdir(agentsDir, { recursive: true });

      const agentContent = `---
name: test-agent
version: 1.2.3
description: Test agent
---

# Test Agent

This is a test agent.
`;
      await writeFile(join(agentsDir, 'test-agent.md'), agentContent);

      // Apply filters
      const result = await applyConvenienceFilters(
        tempDir,
        repoRoot,
        { agents: ['test-agent'] }
      );

      expect(result.errors).toHaveLength(0);
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0]).toMatchObject({
        name: 'test-agent',
        resourceType: 'agent',
        resourceVersion: '1.2.3'
      });
    });

    it('should return undefined version when agent has no version in frontmatter', async () => {
      const agentsDir = join(tempDir, 'agents');
      await mkdir(agentsDir, { recursive: true });

      const agentContent = `---
name: no-version-agent
description: Agent without version
---

# Agent

No version specified.
`;
      await writeFile(join(agentsDir, 'no-version-agent.md'), agentContent);

      const result = await applyConvenienceFilters(
        tempDir,
        repoRoot,
        { agents: ['no-version-agent'] }
      );

      expect(result.errors).toHaveLength(0);
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0]).toMatchObject({
        name: 'no-version-agent',
        resourceType: 'agent',
        resourceVersion: undefined
      });
    });

    it('should extract version from filename-matched agent', async () => {
      const agentsDir = join(tempDir, 'agents');
      await mkdir(agentsDir, { recursive: true });

      const agentContent = `---
name: different-name
version: 2.0.0
---

# Agent

Matched by filename.
`;
      await writeFile(join(agentsDir, 'filename-agent.md'), agentContent);

      const result = await applyConvenienceFilters(
        tempDir,
        repoRoot,
        { agents: ['filename-agent'] }
      );

      expect(result.errors).toHaveLength(0);
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0]).toMatchObject({
        name: 'filename-agent',
        resourceType: 'agent',
        matchedBy: 'filename',
        resourceVersion: '2.0.0'
      });
    });

    it('should trim whitespace from version', async () => {
      const agentsDir = join(tempDir, 'agents');
      await mkdir(agentsDir, { recursive: true });

      const agentContent = `---
name: whitespace-agent
version: "  3.0.0  "
---

# Agent

Version with whitespace.
`;
      await writeFile(join(agentsDir, 'whitespace-agent.md'), agentContent);

      const result = await applyConvenienceFilters(
        tempDir,
        repoRoot,
        { agents: ['whitespace-agent'] }
      );

      expect(result.errors).toHaveLength(0);
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0].resourceVersion).toBe('3.0.0');
    });
  });

  describe('Skill version extraction', () => {
    it('should extract version from SKILL.md frontmatter when present', async () => {
      const skillsDir = join(tempDir, 'skills', 'test-skill');
      await mkdir(skillsDir, { recursive: true });

      const skillContent = `---
name: test-skill
version: 4.5.6
description: Test skill
---

# Test Skill

This is a test skill.
`;
      await writeFile(join(skillsDir, 'SKILL.md'), skillContent);

      const result = await applyConvenienceFilters(
        tempDir,
        repoRoot,
        { skills: ['test-skill'] }
      );

      expect(result.errors).toHaveLength(0);
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0]).toMatchObject({
        name: 'test-skill',
        resourceType: 'skill',
        resourceVersion: '4.5.6'
      });
    });

    it('should return undefined version when skill has no version in frontmatter', async () => {
      const skillsDir = join(tempDir, 'skills', 'no-version-skill');
      await mkdir(skillsDir, { recursive: true });

      const skillContent = `---
name: no-version-skill
description: Skill without version
---

# Skill

No version specified.
`;
      await writeFile(join(skillsDir, 'SKILL.md'), skillContent);

      const result = await applyConvenienceFilters(
        tempDir,
        repoRoot,
        { skills: ['no-version-skill'] }
      );

      expect(result.errors).toHaveLength(0);
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0]).toMatchObject({
        name: 'no-version-skill',
        resourceType: 'skill',
        resourceVersion: undefined
      });
    });

    it('should extract version from directory-matched skill', async () => {
      const skillsDir = join(tempDir, 'skills', 'dirname-skill');
      await mkdir(skillsDir, { recursive: true });

      const skillContent = `---
name: different-skill-name
version: 7.8.9
---

# Skill

Matched by directory name.
`;
      await writeFile(join(skillsDir, 'SKILL.md'), skillContent);

      const result = await applyConvenienceFilters(
        tempDir,
        repoRoot,
        { skills: ['dirname-skill'] }
      );

      expect(result.errors).toHaveLength(0);
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0]).toMatchObject({
        name: 'dirname-skill',
        resourceType: 'skill',
        matchedBy: 'dirname',
        resourceVersion: '7.8.9'
      });
    });
  });

  describe('Mixed agent and skill filtering', () => {
    it('should extract versions for both agents and skills', async () => {
      // Create agent
      const agentsDir = join(tempDir, 'agents');
      await mkdir(agentsDir, { recursive: true });
      const agentContent = `---
name: mixed-agent
version: 1.0.0
---
# Agent
`;
      await writeFile(join(agentsDir, 'mixed-agent.md'), agentContent);

      // Create skill
      const skillsDir = join(tempDir, 'skills', 'mixed-skill');
      await mkdir(skillsDir, { recursive: true });
      const skillContent = `---
name: mixed-skill
version: 2.0.0
---
# Skill
`;
      await writeFile(join(skillsDir, 'SKILL.md'), skillContent);

      const result = await applyConvenienceFilters(
        tempDir,
        repoRoot,
        {
          agents: ['mixed-agent'],
          skills: ['mixed-skill']
        }
      );

      expect(result.errors).toHaveLength(0);
      expect(result.resources).toHaveLength(2);
      
      const agent = result.resources.find(r => r.resourceType === 'agent');
      const skill = result.resources.find(r => r.resourceType === 'skill');

      expect(agent).toMatchObject({
        name: 'mixed-agent',
        resourceVersion: '1.0.0'
      });

      expect(skill).toMatchObject({
        name: 'mixed-skill',
        resourceVersion: '2.0.0'
      });
    });
  });
});
