import { Redis } from "@upstash/redis";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { env } from "../lib/core/env.js";

// Initialize Redis client
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

interface MemoryEntry {
  id: string;
  issueId: string;
  memoryType: "conversation" | "action" | "context";
  timestamp: number;
  type: string;
  data: any;
  relevanceScore?: number;
}

interface MemoryFilters {
  issueId?: string;
  memoryType?: "conversation" | "action" | "context";
  dateFrom?: number;
  dateTo?: number;
  slackChannel?: string;
  searchQuery?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Internal-Token",
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Verify internal token
  const internalToken = req.headers["x-internal-token"];
  if (!internalToken || internalToken !== env.INTERNAL_API_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    switch (req.method) {
      case "GET":
        return await getMemories(req, res);
      case "DELETE":
        return await deleteMemories(req, res);
      case "POST":
        return await bulkMemoryOperations(req, res);
      default:
        return res.status(405).json({ error: "Method not allowed" });
    }
  } catch (error) {
    console.error("Memory browser API error:", error);
    return res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

async function getMemories(req: VercelRequest, res: VercelResponse) {
  const {
    page = "1",
    limit = "20",
    issueId,
    memoryType,
    dateFrom,
    dateTo,
    slackChannel,
    searchQuery,
  } = req.query;

  const pageNum = Number.parseInt(page as string, 10);
  const limitNum = Number.parseInt(limit as string, 10);
  const offset = (pageNum - 1) * limitNum;

  const filters: MemoryFilters = {
    issueId: issueId as string,
    memoryType: memoryType as "conversation" | "action" | "context",
    dateFrom: dateFrom ? Number.parseInt(dateFrom as string, 10) : undefined,
    dateTo: dateTo ? Number.parseInt(dateTo as string, 10) : undefined,
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
  filters: MemoryFilters,
): Promise<MemoryEntry[]> {
  try {
    console.time("getAllFilteredMemories");

    // Get all relevant Redis keys
    const pattern = "memory:issue:*";
    const allKeys = await redis.keys(pattern);

    console.log(`Found ${allKeys.length} total keys`);

    // Filter keys by pattern to avoid wrong data types
    const validKeys = allKeys.filter((key) => {
      // Skip tool-specific memory keys (these are hashes, not lists)
      if (
        key.includes(":tools:") ||
        key.includes(":file:") ||
        key.includes(":related:")
      ) {
        return false;
      }

      const keyParts = key.split(":");
      if (keyParts.length < 4) {
        return false;
      }

      const issueId = keyParts[2];
      const memoryType = keyParts[3];

      // Apply filters early
      if (filters.issueId && issueId !== filters.issueId) return false;
      if (filters.memoryType && memoryType !== filters.memoryType) return false;
      if (!["conversation", "action", "context"].includes(memoryType))
        return false;

      return true;
    });

    console.log(
      `Filtered ${allKeys.length} keys down to ${validKeys.length} valid keys`,
    );

    if (validKeys.length === 0) {
      console.timeEnd("getAllFilteredMemories");
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
        } keys`,
      );

      // Step 1: Check types first
      const typesPipeline = redis.pipeline();
      batch.forEach((key) => {
        typesPipeline.type(key);
      });

      const typeResults = await typesPipeline.exec();
      if (!typeResults) {
        console.error("No type results from pipeline");
        continue;
      }

      // Step 2: Get data only for valid list keys
      const validBatchKeys: string[] = [];
      for (let j = 0; j < batch.length; j++) {
        const key = batch[j];
        const typeResult = typeResults[j];

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
        } else if (typeof typeResult === "string") {
          // Upstash direct format: just the result
          keyType = typeResult;
        } else {
          console.log(`Unexpected type result format for ${key}:`, typeResult);
          continue;
        }

        if (keyType === "list") {
          validBatchKeys.push(key);
        } else {
          console.log(`Skipping key ${key} - wrong type: ${keyType}`);
        }
      }

      if (validBatchKeys.length === 0) {
        console.log("No valid list keys in this batch");
        continue;
      }

      // Step 3: Get data for valid keys
      const dataPipeline = redis.pipeline();
      validBatchKeys.forEach((key) => {
        dataPipeline.lrange(key, 0, -1);
      });

      const dataResults = await dataPipeline.exec();
      if (!dataResults) {
        console.error("No data results from pipeline");
        continue;
      }

      // Step 4: Process the data
      for (let j = 0; j < validBatchKeys.length; j++) {
        const key = validBatchKeys[j];
        const dataResult = dataResults[j];

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
          continue;
        }

        const keyParts = key.split(":");
        const issueId = keyParts[2];
        const memoryType = keyParts[3] as "conversation" | "action" | "context";

        // Process entries
        for (let k = 0; k < entries.length; k++) {
          try {
            const entry = entries[k];

            // Handle both string (JSON) and object formats
            let memoryEntry: any;
            if (typeof entry === "string") {
              // Entry is a JSON string that needs parsing
              memoryEntry = JSON.parse(entry);
            } else if (typeof entry === "object" && entry !== null) {
              // Entry is already an object (Upstash direct format)
              memoryEntry = entry;
            } else {
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
                standardEntry.data,
              ).toLowerCase();
              if (!searchContent.includes(filters.searchQuery.toLowerCase()))
                continue;
            }

            allMemories.push(standardEntry);
          } catch (parseError) {
            console.error(`Error parsing memory entry ${k}:`, parseError);
          }
        }
      }
    }

    // Sort by timestamp (newest first)
    allMemories.sort((a, b) => b.timestamp - a.timestamp);

    console.log(`Processed ${allMemories.length} filtered memories`);
    console.timeEnd("getAllFilteredMemories");
    return allMemories;
  } catch (error) {
    console.error("Error getting filtered memories:", error);
    throw error;
  }
}

async function getMemoryStatistics() {
  try {
    console.log("Starting memory statistics calculation...");

    // Get all memory keys
    const allKeys = await redis.keys("memory:issue:*");
    console.log(`Found ${allKeys.length} total memory keys`);

    // Filter out non-memory keys (tools, file, related, etc.)
    const memoryKeys = allKeys.filter((key) => {
      const parts = key.split(":");
      if (parts.length < 4) return false;

      const memoryType = parts[3];
      return ["conversation", "action", "context"].includes(memoryType);
    });

    console.log(`Found ${memoryKeys.length} memory keys after filtering`);

    const stats = {
      totalMemories: 0,
      conversationMemories: 0,
      actionMemories: 0,
      contextMemories: 0,
      totalIssues: 0,
      oldestMemory: null as number | null,
      newestMemory: null as number | null,
    };

    if (memoryKeys.length === 0) {
      return stats;
    }

    // Get unique issue IDs
    const issueIds = new Set<string>();
    const memoryTypeMap = new Map<string, number>();

    // Process keys in batches
    const batchSize = 10;
    let oldestTimestamp = Number.MAX_SAFE_INTEGER;
    let newestTimestamp = 0;

    for (let i = 0; i < memoryKeys.length; i += batchSize) {
      const batch = memoryKeys.slice(i, i + batchSize);
      console.log(
        `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
          memoryKeys.length / batchSize,
        )}`,
      );

      const pipeline = redis.pipeline();

      // Add commands to pipeline
      for (const key of batch) {
        pipeline.lrange(key, 0, -1);
      }

      try {
        const results = await pipeline.exec();

        for (let j = 0; j < batch.length; j++) {
          const key = batch[j];
          const parts = key.split(":");

          if (parts.length >= 4) {
            const issueId = parts[2];
            const memoryType = parts[3];

            issueIds.add(issueId);

            // Get the pipeline result
            let memories: string[] = [];

            if (results && j < results.length) {
              const result = results[j];

              // Handle both standard Redis format and Upstash direct format
              if (
                Array.isArray(result) &&
                result.length === 2 &&
                (result[0] === null || result[0] instanceof Error)
              ) {
                // Standard Redis: [Error | null, Result]
                const [error, data] = result;
                if (!error && Array.isArray(data)) {
                  memories = data as string[];
                }
              } else if (Array.isArray(result)) {
                // Upstash direct format: just the array of entries
                memories = result as string[];
              }
            }

            const memoryCount = memories.length;
            stats.totalMemories += memoryCount;
            memoryTypeMap.set(
              memoryType,
              (memoryTypeMap.get(memoryType) || 0) + memoryCount,
            );

            // Check timestamps in this memory list
            for (const memoryStr of memories) {
              try {
                const memory =
                  typeof memoryStr === "string"
                    ? JSON.parse(memoryStr)
                    : memoryStr;

                if (memory?.timestamp) {
                  const timestamp = Number(memory.timestamp);

                  if (!Number.isNaN(timestamp)) {
                    if (timestamp < oldestTimestamp) {
                      oldestTimestamp = timestamp;
                    }
                    if (timestamp > newestTimestamp) {
                      newestTimestamp = timestamp;
                    }
                  }
                }
              } catch (parseError) {
                console.error(
                  "Error parsing memory entry for timestamp:",
                  parseError,
                );
              }
            }
          }
        }
      } catch (error) {
        console.error("Error processing batch:", error);
      }
    }

    // Set final timestamp values
    if (oldestTimestamp !== Number.MAX_SAFE_INTEGER) {
      stats.oldestMemory = oldestTimestamp;
    }
    if (newestTimestamp > 0) {
      stats.newestMemory = newestTimestamp;
    }

    // Set memory type counts
    stats.conversationMemories = memoryTypeMap.get("conversation") || 0;
    stats.actionMemories = memoryTypeMap.get("action") || 0;
    stats.contextMemories = memoryTypeMap.get("context") || 0;
    stats.totalIssues = issueIds.size;

    console.log("Memory statistics calculated:", {
      totalMemories: stats.totalMemories,
      totalIssues: stats.totalIssues,
      oldestMemory: stats.oldestMemory
        ? new Date(stats.oldestMemory).toISOString()
        : null,
      newestMemory: stats.newestMemory
        ? new Date(stats.newestMemory).toISOString()
        : null,
    });

    return stats;
  } catch (error) {
    console.error("Error calculating memory statistics:", error);
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
    // Memory ID format: memory:issue:ISSUE_ID:TYPE:TIMESTAMP:INDEX
    const memoryIdStr = memoryId as string;
    const parts = memoryIdStr.split(":");

    if (parts.length < 6) {
      return res.status(400).json({ error: "Invalid memory ID format" });
    }

    // Extract the index (last part) and reconstruct the Redis key (all parts except last 2)
    const index = parts[parts.length - 1];
    const timestamp = parts[parts.length - 2];
    const redisKey = parts.slice(0, -2).join(":"); // memory:issue:ISSUE_ID:TYPE

    console.log(
      `Deleting memory: ID=${memoryIdStr}, RedisKey=${redisKey}, Index=${index}`,
    );

    try {
      // Get the memory list
      const memories = await redis.lrange(redisKey, 0, -1);
      const indexNum = Number.parseInt(index, 10);

      if (
        Number.isNaN(indexNum) ||
        indexNum < 0 ||
        indexNum >= memories.length
      ) {
        return res
          .status(404)
          .json({ error: "Memory not found or invalid index" });
      }

      // Remove the specific memory (Redis doesn't have direct index deletion)
      // So we'll use a placeholder and then remove it
      await redis.lset(redisKey, indexNum, "__DELETED__");
      await redis.lrem(redisKey, 1, "__DELETED__");

      return res.json({
        success: true,
        message: "Memory deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting specific memory:", error);
      return res.status(500).json({ error: "Failed to delete memory" });
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
      console.error("Error deleting memories by type:", error);
      return res.status(500).json({ error: "Failed to delete memories" });
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
      console.error("Error deleting all memories for issue:", error);
      return res.status(500).json({ error: "Failed to delete memories" });
    }
  } else {
    return res.status(400).json({
      error: "Must specify memoryId, or issueId with optional memoryType",
    });
  }
}

async function bulkMemoryOperations(req: VercelRequest, res: VercelResponse) {
  const { operation, filters, memoryIds } = req.body;

  if (!operation) {
    return res.status(400).json({ error: "Operation is required" });
  }

  try {
    switch (operation) {
      case "delete_by_filters":
        return await bulkDeleteByFilters(filters, res);
      case "delete_by_ids":
        return await bulkDeleteByIds(memoryIds, res);
      case "cleanup_old":
        return await cleanupOldMemories(filters, res);
      default:
        return res.status(400).json({ error: "Unknown operation" });
    }
  } catch (error) {
    console.error("Bulk operation error:", error);
    return res.status(500).json({ error: "Bulk operation failed" });
  }
}

async function bulkDeleteByFilters(
  filters: MemoryFilters,
  res: VercelResponse,
) {
  const memories = await getAllFilteredMemories(filters);
  let deletedCount = 0;

  // Group memories by their Redis keys for efficient deletion
  const keyGroups = new Map<string, number[]>();

  for (const memory of memories) {
    // Memory ID format: memory:issue:ISSUE_ID:TYPE:TIMESTAMP:INDEX
    const parts = memory.id.split(":");
    if (parts.length < 6) continue;

    const index = Number.parseInt(parts[parts.length - 1], 10);
    const redisKey = parts.slice(0, -2).join(":"); // memory:issue:ISSUE_ID:TYPE

    if (!keyGroups.has(redisKey)) {
      keyGroups.set(redisKey, []);
    }
    keyGroups.get(redisKey)?.push(index);
  }

  // Delete memories from each key
  for (const [key, indices] of keyGroups.entries()) {
    try {
      // Sort indices in descending order to avoid index shifting issues
      indices.sort((a, b) => b - a);

      for (const index of indices) {
        await redis.lset(key, index, "__DELETED__");
        deletedCount++;
      }

      // Remove all deleted placeholders
      await redis.lrem(key, 0, "__DELETED__");
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
    return res.status(400).json({ error: "memoryIds must be an array" });
  }

  let deletedCount = 0;

  for (const memoryId of memoryIds) {
    try {
      // Memory ID format: memory:issue:ISSUE_ID:TYPE:TIMESTAMP:INDEX
      const parts = memoryId.split(":");
      if (parts.length < 6) {
        console.error(`Invalid memory ID format: ${memoryId}`);
        continue;
      }

      const index = Number.parseInt(parts[parts.length - 1], 10);
      const redisKey = parts.slice(0, -2).join(":"); // memory:issue:ISSUE_ID:TYPE

      if (Number.isNaN(index)) {
        console.error(`Invalid index in memory ID: ${memoryId}`);
        continue;
      }

      await redis.lset(redisKey, index, "__DELETED__");
      deletedCount++;
    } catch (error) {
      console.error(`Error deleting memory ${memoryId}:`, error);
    }
  }

  // Clean up all deleted placeholders (this is inefficient for large operations but works)
  const keys = await redis.keys("memory:issue:*");
  for (const key of keys) {
    try {
      await redis.lrem(key, 0, "__DELETED__");
    } catch (error) {
      console.error(
        `Error cleaning up deleted placeholders for ${key}:`,
        error,
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
  res: VercelResponse,
) {
  const { olderThanDays = 90 } = filters;
  const cutoffTimestamp = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

  const oldMemoryFilters: MemoryFilters = {
    dateTo: cutoffTimestamp,
  };

  return await bulkDeleteByFilters(oldMemoryFilters, res);
}
