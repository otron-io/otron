import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { env } from '../lib/env.js';

// Initialize Redis client
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

interface MemoryEntry {
  id: string;
  issueId: string;
  memoryType: 'conversation' | 'action' | 'context';
  timestamp: number;
  type: string;
  data: any;
  relevanceScore?: number;
}

interface MemoryFilters {
  issueId?: string;
  memoryType?: 'conversation' | 'action' | 'context';
  dateFrom?: number;
  dateTo?: number;
  slackChannel?: string;
  searchQuery?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Internal-Token'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Verify internal token
  const internalToken = req.headers['x-internal-token'];
  if (!internalToken || internalToken !== env.INTERNAL_API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    switch (req.method) {
      case 'GET':
        return await getMemories(req, res);
      case 'DELETE':
        return await deleteMemories(req, res);
      case 'POST':
        return await bulkMemoryOperations(req, res);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Memory browser API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

async function getMemories(req: VercelRequest, res: VercelResponse) {
  const {
    page = '1',
    limit = '20',
    issueId,
    memoryType,
    dateFrom,
    dateTo,
    slackChannel,
    searchQuery,
  } = req.query;

  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);
  const offset = (pageNum - 1) * limitNum;

  const filters: MemoryFilters = {
    issueId: issueId as string,
    memoryType: memoryType as 'conversation' | 'action' | 'context',
    dateFrom: dateFrom ? parseInt(dateFrom as string, 10) : undefined,
    dateTo: dateTo ? parseInt(dateTo as string, 10) : undefined,
    slackChannel: slackChannel as string,
    searchQuery: searchQuery as string,
  };

  // Get all memory keys that match our filters
  const allMemories = await getAllFilteredMemories(filters);

  // Sort by timestamp (newest first)
  allMemories.sort((a, b) => b.timestamp - a.timestamp);

  // Apply pagination
  const paginatedMemories = allMemories.slice(offset, offset + limitNum);

  // Get memory statistics
  const stats = await getMemoryStatistics();

  return res.json({
    memories: paginatedMemories,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: allMemories.length,
      totalPages: Math.ceil(allMemories.length / limitNum),
    },
    statistics: stats,
  });
}

async function getAllFilteredMemories(
  filters: MemoryFilters
): Promise<MemoryEntry[]> {
  try {
    const pattern = 'memory:issue:*';
    const keys = await redis.keys(pattern);

    console.log(`Found ${keys.length} memory keys`);

    const allMemories: MemoryEntry[] = [];

    for (const key of keys) {
      try {
        // Skip tool-specific memory keys (these are hashes, not lists)
        if (key.includes(':tools:')) {
          continue;
        }

        // Skip relationship keys
        if (key.includes(':file:') || key.includes(':related:')) {
          continue;
        }

        // Only process standard memory type keys (conversation, action, context)
        const keyParts = key.split(':');
        if (keyParts.length < 4) {
          continue;
        }

        const memoryType = keyParts[3]; // memory:issue:{issueId}:{memoryType}
        if (!['conversation', 'action', 'context'].includes(memoryType)) {
          continue;
        }

        // Check Redis key type before attempting to read
        const keyType = await redis.type(key);
        if (keyType !== 'list') {
          console.log(`Skipping key ${key} - wrong type: ${keyType}`);
          continue;
        }

        const issueId = keyParts[2];

        // Apply issue filter early
        if (filters.issueId && issueId !== filters.issueId) {
          continue;
        }

        // Apply memory type filter early
        if (filters.memoryType && memoryType !== filters.memoryType) {
          continue;
        }

        console.log(`Processing memory key: ${key}`);

        // Get all entries from this list
        const entries = await redis.lrange(key, 0, -1);

        for (const entry of entries) {
          try {
            const memoryEntry =
              typeof entry === 'string' ? JSON.parse(entry) : entry;

            // Create standardized memory entry
            const standardEntry: MemoryEntry = {
              id: `${key}:${memoryEntry.timestamp}`, // Create unique ID
              issueId,
              memoryType: memoryType as 'conversation' | 'action' | 'context',
              timestamp: memoryEntry.timestamp,
              type: memoryEntry.type || memoryType,
              data: memoryEntry.data || memoryEntry,
              relevanceScore: memoryEntry.relevanceScore,
            };

            // Apply filters
            if (
              filters.dateFrom &&
              standardEntry.timestamp < filters.dateFrom
            ) {
              continue;
            }

            if (filters.dateTo && standardEntry.timestamp > filters.dateTo) {
              continue;
            }

            if (filters.slackChannel) {
              // Check if this memory is related to the specified Slack channel
              const dataStr = JSON.stringify(standardEntry.data).toLowerCase();
              if (!dataStr.includes(filters.slackChannel.toLowerCase())) {
                continue;
              }
            }

            if (filters.searchQuery) {
              // Search within the memory content
              const searchContent = JSON.stringify(
                standardEntry.data
              ).toLowerCase();
              if (!searchContent.includes(filters.searchQuery.toLowerCase())) {
                continue;
              }
            }

            allMemories.push(standardEntry);
          } catch (parseError) {
            console.error(`Error parsing memory entry:`, parseError);
            continue;
          }
        }
      } catch (keyError) {
        console.error(`Error processing memory key: ${key}`, keyError);
        continue; // Skip this key and continue with others
      }
    }

    // Sort by timestamp (newest first)
    allMemories.sort((a, b) => b.timestamp - a.timestamp);

    console.log(`Filtered memories: ${allMemories.length}`);
    return allMemories;
  } catch (error) {
    console.error('Error getting filtered memories:', error);
    throw error;
  }
}

async function getMemoryStatistics() {
  try {
    const keys = await redis.keys('memory:issue:*');
    const stats = {
      totalMemories: 0,
      conversationMemories: 0,
      actionMemories: 0,
      contextMemories: 0,
      totalIssues: new Set<string>(),
      oldestMemory: null as number | null,
      newestMemory: null as number | null,
    };

    for (const key of keys) {
      const keyParts = key.split(':');
      if (keyParts.length >= 4) {
        const issueId = keyParts[2];
        const memoryType = keyParts[3];

        stats.totalIssues.add(issueId);

        const memoryCount = await redis.llen(key);
        stats.totalMemories += memoryCount;

        if (memoryType === 'conversation')
          stats.conversationMemories += memoryCount;
        else if (memoryType === 'action') stats.actionMemories += memoryCount;
        else if (memoryType === 'context') stats.contextMemories += memoryCount;

        // Get timestamp of newest and oldest memories
        if (memoryCount > 0) {
          try {
            const newest = await redis.lindex(key, 0);
            const oldest = await redis.lindex(key, -1);

            if (newest) {
              const newestMemory = JSON.parse(
                typeof newest === 'string' ? newest : JSON.stringify(newest)
              );
              if (
                !stats.newestMemory ||
                newestMemory.timestamp > stats.newestMemory
              ) {
                stats.newestMemory = newestMemory.timestamp;
              }
            }

            if (oldest) {
              const oldestMemory = JSON.parse(
                typeof oldest === 'string' ? oldest : JSON.stringify(oldest)
              );
              if (
                !stats.oldestMemory ||
                oldestMemory.timestamp < stats.oldestMemory
              ) {
                stats.oldestMemory = oldestMemory.timestamp;
              }
            }
          } catch (error) {
            console.error('Error parsing timestamps for stats:', error);
          }
        }
      }
    }

    return {
      ...stats,
      totalIssues: stats.totalIssues.size,
    };
  } catch (error) {
    console.error('Error getting memory statistics:', error);
    return {
      totalMemories: 0,
      conversationMemories: 0,
      actionMemories: 0,
      contextMemories: 0,
      totalIssues: 0,
      oldestMemory: null,
      newestMemory: null,
    };
  }
}

async function deleteMemories(req: VercelRequest, res: VercelResponse) {
  const { memoryId, issueId, memoryType } = req.query;

  if (memoryId) {
    // Delete specific memory by ID
    const [key, index] = (memoryId as string).split(':').slice(-2);
    const fullKey = (memoryId as string).replace(`:${index}`, '');

    try {
      // Get the memory list
      const memories = await redis.lrange(fullKey, 0, -1);
      const indexNum = parseInt(index, 10);

      if (indexNum >= 0 && indexNum < memories.length) {
        // Remove the specific memory (Redis doesn't have direct index deletion)
        // So we'll use a placeholder and then remove it
        await redis.lset(fullKey, indexNum, '__DELETED__');
        await redis.lrem(fullKey, 1, '__DELETED__');

        return res.json({
          success: true,
          message: 'Memory deleted successfully',
        });
      } else {
        return res.status(404).json({ error: 'Memory not found' });
      }
    } catch (error) {
      console.error('Error deleting specific memory:', error);
      return res.status(500).json({ error: 'Failed to delete memory' });
    }
  } else if (issueId && memoryType) {
    // Delete all memories of a specific type for an issue
    const key = `memory:issue:${issueId}:${memoryType}`;

    try {
      await redis.del(key);
      return res.json({
        success: true,
        message: `All ${memoryType} memories deleted for issue ${issueId}`,
      });
    } catch (error) {
      console.error('Error deleting memories by type:', error);
      return res.status(500).json({ error: 'Failed to delete memories' });
    }
  } else if (issueId) {
    // Delete all memories for an issue
    const keys = [
      `memory:issue:${issueId}:conversation`,
      `memory:issue:${issueId}:action`,
      `memory:issue:${issueId}:context`,
    ];

    try {
      await redis.del(...keys);
      return res.json({
        success: true,
        message: `All memories deleted for issue ${issueId}`,
      });
    } catch (error) {
      console.error('Error deleting all memories for issue:', error);
      return res.status(500).json({ error: 'Failed to delete memories' });
    }
  } else {
    return res.status(400).json({
      error: 'Must specify memoryId, or issueId with optional memoryType',
    });
  }
}

async function bulkMemoryOperations(req: VercelRequest, res: VercelResponse) {
  const { operation, filters, memoryIds } = req.body;

  if (!operation) {
    return res.status(400).json({ error: 'Operation is required' });
  }

  try {
    switch (operation) {
      case 'delete_by_filters':
        return await bulkDeleteByFilters(filters, res);
      case 'delete_by_ids':
        return await bulkDeleteByIds(memoryIds, res);
      case 'cleanup_old':
        return await cleanupOldMemories(filters, res);
      default:
        return res.status(400).json({ error: 'Unknown operation' });
    }
  } catch (error) {
    console.error('Bulk operation error:', error);
    return res.status(500).json({ error: 'Bulk operation failed' });
  }
}

async function bulkDeleteByFilters(
  filters: MemoryFilters,
  res: VercelResponse
) {
  const memories = await getAllFilteredMemories(filters);
  let deletedCount = 0;

  // Group memories by their Redis keys for efficient deletion
  const keyGroups = new Map<string, number[]>();

  for (const memory of memories) {
    const [key, index] = memory.id.split(':').slice(-2);
    const fullKey = memory.id.replace(`:${index}`, '');

    if (!keyGroups.has(fullKey)) {
      keyGroups.set(fullKey, []);
    }
    keyGroups.get(fullKey)!.push(parseInt(index, 10));
  }

  // Delete memories from each key
  for (const [key, indices] of keyGroups.entries()) {
    try {
      // Sort indices in descending order to avoid index shifting issues
      indices.sort((a, b) => b - a);

      for (const index of indices) {
        await redis.lset(key, index, '__DELETED__');
        deletedCount++;
      }

      // Remove all deleted placeholders
      await redis.lrem(key, 0, '__DELETED__');
    } catch (error) {
      console.error(`Error deleting from key ${key}:`, error);
    }
  }

  return res.json({
    success: true,
    message: `Deleted ${deletedCount} memories`,
    deletedCount,
  });
}

async function bulkDeleteByIds(memoryIds: string[], res: VercelResponse) {
  if (!Array.isArray(memoryIds)) {
    return res.status(400).json({ error: 'memoryIds must be an array' });
  }

  let deletedCount = 0;

  for (const memoryId of memoryIds) {
    try {
      const [key, index] = memoryId.split(':').slice(-2);
      const fullKey = memoryId.replace(`:${index}`, '');
      const indexNum = parseInt(index, 10);

      await redis.lset(fullKey, indexNum, '__DELETED__');
      deletedCount++;
    } catch (error) {
      console.error(`Error deleting memory ${memoryId}:`, error);
    }
  }

  // Clean up all deleted placeholders (this is inefficient for large operations but works)
  const keys = await redis.keys('memory:issue:*');
  for (const key of keys) {
    try {
      await redis.lrem(key, 0, '__DELETED__');
    } catch (error) {
      console.error(
        `Error cleaning up deleted placeholders for ${key}:`,
        error
      );
    }
  }

  return res.json({
    success: true,
    message: `Deleted ${deletedCount} memories`,
    deletedCount,
  });
}

async function cleanupOldMemories(
  filters: { olderThanDays: number },
  res: VercelResponse
) {
  const { olderThanDays = 90 } = filters;
  const cutoffTimestamp = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

  const oldMemoryFilters: MemoryFilters = {
    dateTo: cutoffTimestamp,
  };

  return await bulkDeleteByFilters(oldMemoryFilters, res);
}
