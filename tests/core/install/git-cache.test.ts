import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  computeGitUrlHash,
  getGitCommitCacheDir,
  getGitCachePath
} from '../../../src/utils/git-cache.js';

describe('Git Cache', () => {
  describe('computeGitUrlHash', () => {
    it('should generate consistent hash for same URL', () => {
      const url = 'https://github.com/anthropics/claude-code.git';
      const hash1 = computeGitUrlHash(url);
      const hash2 = computeGitUrlHash(url);
      
      assert.strictEqual(hash1, hash2);
      assert.strictEqual(hash1.length, 12); // 12 hex chars
    });
    
    it('should generate different hashes for different URLs', () => {
      const url1 = 'https://github.com/user1/repo.git';
      const url2 = 'https://github.com/user2/repo.git';
      
      const hash1 = computeGitUrlHash(url1);
      const hash2 = computeGitUrlHash(url2);
      
      assert.notStrictEqual(hash1, hash2);
    });
    
    it('should normalize URLs before hashing', () => {
      const url1 = 'https://github.com/User/Repo.git';
      const url2 = 'https://github.com/user/repo.git';
      
      const hash1 = computeGitUrlHash(url1);
      const hash2 = computeGitUrlHash(url2);
      
      assert.strictEqual(hash1, hash2); // Should be same after normalization
    });
    
    it('should handle SSH format', () => {
      const url = 'git@github.com:anthropics/claude-code.git';
      const hash = computeGitUrlHash(url);
      
      assert.strictEqual(hash.length, 12);
    });
  });
  
  describe('getGitCommitCacheDir', () => {
    it('should generate correct cache directory path', () => {
      const url = 'https://github.com/anthropics/claude-code.git';
      const commitSha = 'abc1234567890';
      
      const path = getGitCommitCacheDir(url, commitSha);
      
      // Should end with <hash>/<short-sha>
      assert.ok(path.includes('cache/git/'));
      assert.ok(path.endsWith('/abc1234')); // 7 chars
    });
    
    it('should truncate commit SHA to 7 characters', () => {
      const url = 'https://github.com/user/repo.git';
      const commitSha = 'abcdef1234567890';
      
      const path = getGitCommitCacheDir(url, commitSha);
      
      assert.ok(path.endsWith('/abcdef1'));
    });
  });
  
  describe('getGitCachePath', () => {
    it('should return commit dir when no subdirectory specified', () => {
      const url = 'https://github.com/user/repo.git';
      const commitSha = 'abc1234';
      
      const path = getGitCachePath(url, commitSha);
      
      assert.ok(path.endsWith('/abc1234'));
      assert.ok(!path.includes('plugins'));
    });
    
    it('should include subdirectory in path when specified', () => {
      const url = 'https://github.com/anthropics/claude-code.git';
      const commitSha = 'abc1234';
      const subdirectory = 'plugins/commit-commands';
      
      const path = getGitCachePath(url, commitSha, subdirectory);
      
      assert.ok(path.endsWith('/abc1234/plugins/commit-commands'));
    });
  });
});
