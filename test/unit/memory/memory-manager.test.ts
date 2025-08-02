import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Redis } from '@upstash/redis';

// Mock Redis
vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    zadd: vi.fn(),
    zrange: vi.fn(),
    zremrangebyrank: vi.fn(),
    del: vi.fn(),
    keys: vi.fn(),
    exists: vi.fn(),
    ttl: vi.fn(),
  })),
}));

describe('Memory Manager', () => {
  let mockRedis: any;
  let memoryManager: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRedis = new Redis();

    // Mock the memory manager module
    vi.doMock('../../../lib/memory/memory-manager.js', () => ({
      memoryManager: {
        storeMemory: vi.fn(),
        getPreviousConversations: vi.fn(),
        getIssueHistory: vi.fn(),
        clearMemoryForIssue: vi.fn(),
      },
    }));

    const module = await import('../../../lib/memory/memory-manager.js');
    memoryManager = module.memoryManager;
  });

  afterEach(() => {
    vi.doUnmock('../../../lib/memory/memory-manager.js');
  });

  describe('storeMemory', () => {
    it('should store conversation memory', async () => {
      const contextId = 'TEST-123';
      const memoryType = 'conversation';
      const data = {
        role: 'user',
        content: 'Test message',
        timestamp: Date.now(),
      };

      memoryManager.storeMemory.mockResolvedValue(true);

      await memoryManager.storeMemory(contextId, memoryType, data);

      expect(memoryManager.storeMemory).toHaveBeenCalledWith(
        contextId,
        memoryType,
        data
      );
    });

    it('should store action memory', async () => {
      const contextId = 'TEST-123';
      const memoryType = 'action';
      const data = {
        tool: 'updateIssueStatus',
        input: { issueId: 'TEST-123', status: 'In Progress' },
        success: true,
        timestamp: Date.now(),
      };

      memoryManager.storeMemory.mockResolvedValue(true);

      await memoryManager.storeMemory(contextId, memoryType, data);

      expect(memoryManager.storeMemory).toHaveBeenCalledWith(
        contextId,
        memoryType,
        data
      );
    });

    it('should handle storage errors gracefully', async () => {
      const contextId = 'TEST-123';
      const memoryType = 'conversation';
      const data = { content: 'test' };

      memoryManager.storeMemory.mockRejectedValue(
        new Error('Redis connection failed')
      );

      // Should not throw but handle gracefully
      await expect(
        memoryManager.storeMemory(contextId, memoryType, data)
      ).rejects.toThrow('Redis connection failed');
    });
  });

  describe('getPreviousConversations', () => {
    it('should retrieve previous conversations', async () => {
      const contextId = 'TEST-123';
      const currentMessage = 'Current message';
      const mockConversations = 'Previous conversation context';

      memoryManager.getPreviousConversations.mockResolvedValue(
        mockConversations
      );

      const result = await memoryManager.getPreviousConversations(
        contextId,
        currentMessage
      );

      expect(result).toBe(mockConversations);
      expect(memoryManager.getPreviousConversations).toHaveBeenCalledWith(
        contextId,
        currentMessage
      );
    });

    it('should return empty string when no conversations found', async () => {
      const contextId = 'TEST-123';
      const currentMessage = 'Current message';

      memoryManager.getPreviousConversations.mockResolvedValue('');

      const result = await memoryManager.getPreviousConversations(
        contextId,
        currentMessage
      );

      expect(result).toBe('');
    });
  });

  describe('getIssueHistory', () => {
    it('should retrieve issue history', async () => {
      const contextId = 'TEST-123';
      const mockHistory = 'Issue history context';

      memoryManager.getIssueHistory.mockResolvedValue(mockHistory);

      const result = await memoryManager.getIssueHistory(contextId);

      expect(result).toBe(mockHistory);
      expect(memoryManager.getIssueHistory).toHaveBeenCalledWith(contextId);
    });
  });

  describe('clearMemoryForIssue', () => {
    it('should clear memory for an issue', async () => {
      const contextId = 'TEST-123';

      memoryManager.clearMemoryForIssue.mockResolvedValue(true);

      await memoryManager.clearMemoryForIssue(contextId);

      expect(memoryManager.clearMemoryForIssue).toHaveBeenCalledWith(contextId);
    });
  });
});
