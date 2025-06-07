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
    console.time('getAllFilteredMemories');

    // Get all relevant Redis keys
    const pattern = 'memory:issue:*';
    const allKeys = await redis.keys(pattern);

    console.log(`Found ${allKeys.length} total keys`);

    // Filter keys by pattern to avoid wrong data types
    const validKeys = allKeys.filter((key) => {
      // Skip tool-specific memory keys (these are hashes, not lists)
      if (
        key.includes(':tools:') ||
        key.includes(':file:') ||
        key.includes(':related:')
      ) {
        return false;
      }

      const keyParts = key.split(':');
      if (keyParts.length < 4) {
        return false;
      }

      const issueId = keyParts[2];
      const memoryType = keyParts[3];

      // Apply filters early
      if (filters.issueId && issueId !== filters.issueId) return false;
      if (filters.memoryType && memoryType !== filters.memoryType) return false;
      if (!['conversation', 'action', 'context'].includes(memoryType))
        return false;

      return true;
    });

    console.log(
      `Filtered ${allKeys.length} keys down to ${validKeys.length} valid keys`
    );

    if (validKeys.length === 0) {
      console.timeEnd('getAllFilteredMemories');
      return [];
    }

    // Process keys in optimized batches
    const batchSize = 5; // Smaller batches for better reliability
    const allMemories: MemoryEntry[] = [];

    for (let i = 0; i < validKeys.length; i += batchSize) {
      const batch = validKeys.slice(i, i + batchSize);

      console.log(
        `Processing batch ${Math.floor(i / batchSize) + 1}: ${
          batch.length
        } keys`
      );

      // Step 1: Check types first
      const typesPipeline = redis.pipeline();
      batch.forEach((key) => {
        typesPipeline.type(key);
      });

      const typeResults = await typesPipeline.exec();
      if (!typeResults) {
        console.error('No type results from pipeline');
        continue;
      }

      console.log(
        `Pipeline returned ${typeResults.length} type results for ${batch.length} keys`
      );
      console.log('Sample type result:', typeResults[0]);

      // Step 2: Get data only for valid list keys
      const validBatchKeys: string[] = [];
      for (let j = 0; j < batch.length; j++) {
        const key = batch[j];
        const typeResult = typeResults[j];

        console.log(`Type result for ${key}:`, typeResult);

        // Handle Upstash Redis pipeline format - results can be direct values or [error, result] tuples
        let keyType: string;
        if (Array.isArray(typeResult) && typeResult.length >= 2) {
          // Standard Redis format: [error, result]
          const [error, result] = typeResult as [Error | null, string];
          if (error) {
            console.log(`Error checking type for ${key}:`, error);
            continue;
          }
          keyType = result;
        } else if (typeof typeResult === 'string') {
          // Upstash direct format: just the result
          keyType = typeResult;
        } else {
          console.log(`Unexpected type result format for ${key}:`, typeResult);
          continue;
        }

        if (keyType === 'list') {
          validBatchKeys.push(key);
          console.log(`Added ${key} to valid batch keys (type: ${keyType})`);
        } else {
          console.log(`Skipping key ${key} - wrong type: ${keyType}`);
        }
      }

      if (validBatchKeys.length === 0) {
        console.log('No valid list keys in this batch');
        continue;
      }

      // Step 3: Get data for valid keys
      const dataPipeline = redis.pipeline();
      validBatchKeys.forEach((key) => {
        dataPipeline.lrange(key, 0, -1);
      });

      const dataResults = await dataPipeline.exec();
      if (!dataResults) {
        console.error('No data results from pipeline');
        continue;
      }

      // Step 4: Process the data
      for (let j = 0; j < validBatchKeys.length; j++) {
        const key = validBatchKeys[j];
        const dataResult = dataResults[j];

        console.log(
          `Data result for ${key}:`,
          Array.isArray(dataResult)
            ? `${dataResult.length} entries`
            : typeof dataResult
        );

        // Handle Upstash Redis pipeline format for lrange results
        let entries: any[];
        if (
          Array.isArray(dataResult) &&
          dataResult.length >= 2 &&
          dataResult[0] === null
        ) {
          // Standard Redis format: [error, result]
          const [error, result] = dataResult as [Error | null, any[]];
          if (error) {
            console.log(`Error getting data for ${key}:`, error);
            continue;
          }
          entries = result;
        } else if (Array.isArray(dataResult)) {
          // Upstash direct format: just the array of entries (could be strings or objects)
          entries = dataResult;
        } else {
          console.log(`Unexpected data result format for ${key}:`, dataResult);
          continue;
        }

        if (!entries || entries.length === 0) {
          console.log(`No entries found for key: ${key}`);
          continue;
        }

        const keyParts = key.split(':');
        const issueId = keyParts[2];
        const memoryType = keyParts[3] as 'conversation' | 'action' | 'context';

        console.log(`Processing ${entries.length} entries for ${key}`);

        // Process entries
        for (let k = 0; k < entries.length; k++) {
          try {
            const entry = entries[k];

            console.log(
              `Entry ${k} type:`,
              typeof entry,
              entry ? 'has data' : 'no data'
            );

            // Handle both string (JSON) and object formats
            let memoryEntry: any;
            if (typeof entry === 'string') {
              // Entry is a JSON string that needs parsing
              memoryEntry = JSON.parse(entry);
              console.log(`Parsed JSON entry ${k}:`, {
                timestamp: memoryEntry.timestamp,
                type: memoryEntry.type,
              });
            } else if (typeof entry === 'object' && entry !== null) {
              // Entry is already an object (Upstash direct format)
              memoryEntry = entry;
              console.log(`Direct object entry ${k}:`, {
                timestamp: memoryEntry.timestamp,
                type: memoryEntry.type,
              });
            } else {
              console.log(`Skipping invalid entry ${k}:`, entry);
              continue;
            }

            // Create standardized memory entry
            const standardEntry: MemoryEntry = {
              id: `${key}:${memoryEntry.timestamp}:${k}`,
              issueId,
              memoryType,
              timestamp: memoryEntry.timestamp,
              type: memoryEntry.type || memoryType,
              data: memoryEntry.data || memoryEntry,
              relevanceScore: memoryEntry.relevanceScore,
            };

            // Apply remaining filters
            if (filters.dateFrom && standardEntry.timestamp < filters.dateFrom)
              continue;
            if (filters.dateTo && standardEntry.timestamp > filters.dateTo)
              continue;

            if (filters.slackChannel) {
              const dataStr = JSON.stringify(standardEntry.data).toLowerCase();
              if (!dataStr.includes(filters.slackChannel.toLowerCase()))
                continue;
            }

            if (filters.searchQuery) {
              const searchContent = JSON.stringify(
                standardEntry.data
              ).toLowerCase();
              if (!searchContent.includes(filters.searchQuery.toLowerCase()))
                continue;
            }

            allMemories.push(standardEntry);
          } catch (parseError) {
            console.error(`Error parsing memory entry ${k}:`, parseError);
            continue;
          }
        }
      }
    }

    // Sort by timestamp (newest first)
    allMemories.sort((a, b) => b.timestamp - a.timestamp);

    console.log(`Processed ${allMemories.length} filtered memories`);
    console.timeEnd('getAllFilteredMemories');
    return allMemories;
  } catch (error) {
    console.error('Error getting filtered memories:', error);
    throw error;
  }
}

async function getMemoryStatistics() {
  try {
    console.time('getMemoryStatistics');

    const pattern = 'memory:issue:*';
    const allKeys = await redis.keys(pattern);

    console.log(`Found ${allKeys.length} total keys for statistics`);

    // Filter keys efficiently
    const validKeys = allKeys.filter((key) => {
      if (
        key.includes(':tools:') ||
        key.includes(':file:') ||
        key.includes(':related:')
      ) {
        return false;
      }

      const keyParts = key.split(':');
      if (keyParts.length < 4) return false;

      const memoryType = keyParts[3];
      return ['conversation', 'action', 'context'].includes(memoryType);
    });

    console.log(`Processing statistics for ${validKeys.length} valid keys`);

    if (validKeys.length === 0) {
      console.timeEnd('getMemoryStatistics');
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

    // Use optimized pipeline for statistics
    const batchSize = 10;
    let totalMemories = 0;
    let conversationMemories = 0;
    let actionMemories = 0;
    let contextMemories = 0;
    const uniqueIssues = new Set<string>();
    let oldestMemory: number | null = null;
    let newestMemory: number | null = null;

    for (let i = 0; i < validKeys.length; i += batchSize) {
      const batch = validKeys.slice(i, i + batchSize);

      // Step 1: Check types
      const typesPipeline = redis.pipeline();
      batch.forEach((key) => {
        typesPipeline.type(key);
      });

      const typeResults = await typesPipeline.exec();
      if (!typeResults) continue;

      // Step 2: Get lengths and timestamps for valid keys
      const validBatchKeys: string[] = [];
      for (let j = 0; j < batch.length; j++) {
        const key = batch[j];
        const typeResult = typeResults[j];

        // Handle Upstash Redis pipeline format
        let keyType: string;
        if (Array.isArray(typeResult) && typeResult.length >= 2) {
          // Standard Redis format: [error, result]
          const [error, result] = typeResult as [Error | null, string];
          if (error || result !== 'list') {
            continue;
          }
          keyType = result;
        } else if (typeof typeResult === 'string') {
          // Upstash direct format: just the result
          keyType = typeResult;
        } else {
          continue;
        }

        if (keyType === 'list') {
          validBatchKeys.push(key);
        }
      }

      if (validBatchKeys.length === 0) continue;

      // Step 3: Get stats data
      const statsPipeline = redis.pipeline();
      validBatchKeys.forEach((key) => {
        statsPipeline.llen(key);
        statsPipeline.lindex(key, 0); // newest
        statsPipeline.lindex(key, -1); // oldest
      });

      const statsResults = await statsPipeline.exec();
      if (!statsResults) continue;

      // Step 4: Process results
      for (let j = 0; j < validBatchKeys.length; j++) {
        const key = validBatchKeys[j];
        const keyParts = key.split(':');
        const issueId = keyParts[2];
        const memoryType = keyParts[3];

        // Handle Upstash Redis pipeline format for multiple operations
        const lenIndex = j * 3;
        const newestIndex = j * 3 + 1;
        const oldestIndex = j * 3 + 2;

        const lenResult = statsResults[lenIndex];
        const newestResult = statsResults[newestIndex];
        const oldestResult = statsResults[oldestIndex];

        // Parse length result
        let listLength: number;
        if (Array.isArray(lenResult) && lenResult.length >= 2) {
          // Standard Redis format: [error, result]
          const [error, result] = lenResult as [Error | null, number];
          if (error) continue;
          listLength = result;
        } else if (typeof lenResult === 'number') {
          // Upstash direct format: just the number
          listLength = lenResult;
        } else {
          continue;
        }

        if (listLength === 0) continue;

        uniqueIssues.add(issueId);
        totalMemories += listLength;

        // Count by memory type
        switch (memoryType) {
          case 'conversation':
            conversationMemories += listLength;
            break;
          case 'action':
            actionMemories += listLength;
            break;
          case 'context':
            contextMemories += listLength;
            break;
        }

        // Process timestamps
        try {
          // Parse newest result
          let newestData: string | null = null;
          if (Array.isArray(newestResult) && newestResult.length >= 2) {
            // Standard Redis format: [error, result]
            const [error, result] = newestResult as [
              Error | null,
              string | null
            ];
            if (!error) newestData = result;
          } else if (
            typeof newestResult === 'string' ||
            newestResult === null
          ) {
            // Upstash direct format: just the string or null
            newestData = newestResult;
          }

          // Parse oldest result
          let oldestData: string | null = null;
          if (Array.isArray(oldestResult) && oldestResult.length >= 2) {
            // Standard Redis format: [error, result]
            const [error, result] = oldestResult as [
              Error | null,
              string | null
            ];
            if (!error) oldestData = result;
          } else if (
            typeof oldestResult === 'string' ||
            oldestResult === null
          ) {
            // Upstash direct format: just the string or null
            oldestData = oldestResult;
          }

          // Process timestamps
          if (newestData) {
            const newestParsed =
              typeof newestData === 'string'
                ? JSON.parse(newestData)
                : newestData;
            const newestTimestamp = newestParsed.timestamp;
            if (
              newestTimestamp &&
              (newestMemory === null || newestTimestamp > newestMemory)
            ) {
              newestMemory = newestTimestamp;
            }
          }

          if (oldestData) {
            const oldestParsed =
              typeof oldestData === 'string'
                ? JSON.parse(oldestData)
                : oldestData;
            const oldestTimestamp = oldestParsed.timestamp;
            if (
              oldestTimestamp &&
              (oldestMemory === null || oldestTimestamp < oldestMemory)
            ) {
              oldestMemory = oldestTimestamp;
            }
          }
        } catch (parseError) {
          console.error(
            `Error parsing timestamp entries for ${key}:`,
            parseError
          );
        }
      }
    }

    const stats = {
      totalMemories,
      conversationMemories,
      actionMemories,
      contextMemories,
      totalIssues: uniqueIssues.size,
      oldestMemory,
      newestMemory,
    };

    console.log(`Statistics result:`, stats);
    console.timeEnd('getMemoryStatistics');

    return stats;
  } catch (error) {
    console.error('Error getting memory statistics:', error);
    throw error;
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
