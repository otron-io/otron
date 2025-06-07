import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { env } from '../lib/env.js';
import { withInternalAccess } from '../lib/auth.js';

// Initialize Redis client
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

interface EmbeddingStatus {
  repository: string;
  status: 'in_progress' | 'completed' | 'failed';
  progress: number;
  processedFiles: number;
  totalFiles?: number;
  lastProcessedAt: number;
  startedAt?: number;
  errors?: string[];
  lastCommitSha?: string;
}

// Helper function to get processed files key
const getProcessedFilesKey = (repo: string) =>
  `embedding:repo:${repo}:processed_files`;

async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get all repository status keys
    const keys = await redis.keys('embedding:repo:*:status');
    const repositories: EmbeddingStatus[] = [];

    for (const key of keys) {
      try {
        const repoStatus = await redis.get(key);

        if (!repoStatus) continue;

        let parsedStatus: any;

        // Handle different types of status data
        if (typeof repoStatus === 'object' && repoStatus !== null) {
          parsedStatus = repoStatus;
        } else if (typeof repoStatus === 'string') {
          // Skip invalid entries
          if (repoStatus === '[object Object]') {
            console.warn(
              `Found invalid repository status for ${key}, skipping`
            );
            continue;
          }

          try {
            parsedStatus = JSON.parse(repoStatus);
          } catch (parseError) {
            console.error(
              `Error parsing repository status for ${key}:`,
              parseError
            );
            continue;
          }
        } else {
          console.error(
            `Unexpected repository status type for ${key}: ${typeof repoStatus}`
          );
          continue;
        }

        // Validate required fields
        if (!parsedStatus.repository || !parsedStatus.status) {
          console.warn(
            `Invalid repository status data for ${key}, missing required fields`
          );
          continue;
        }

        // Get actual processed files count from Redis set
        let actualProcessedFiles = 0;
        let actualTotalFiles = parsedStatus.totalFiles;

        try {
          const processedFilesSet = await redis.smembers(
            getProcessedFilesKey(parsedStatus.repository)
          );
          actualProcessedFiles = processedFilesSet
            ? processedFilesSet.length
            : 0;

          // For completed repositories, set totalFiles to match processedFiles
          // This fixes the count discrepancy after re-embedding operations
          if (parsedStatus.status === 'completed') {
            actualTotalFiles = actualProcessedFiles;
          } else if (parsedStatus.status === 'in_progress') {
            // For in-progress repos, use the larger of the two values to avoid showing more processed than total
            actualTotalFiles = Math.max(
              actualProcessedFiles,
              parsedStatus.totalFiles || 0
            );
          }
        } catch (error) {
          console.error(
            `Error getting processed files count for ${parsedStatus.repository}:`,
            error
          );
          // Fall back to stored values if Redis query fails
          actualProcessedFiles = parsedStatus.processedFiles || 0;
        }

        // Transform to our interface format
        const status: EmbeddingStatus = {
          repository: parsedStatus.repository,
          status: parsedStatus.status,
          progress: parsedStatus.progress || 0,
          processedFiles: actualProcessedFiles,
          totalFiles: actualTotalFiles,
          lastProcessedAt: parsedStatus.lastProcessedAt || Date.now(),
          startedAt: parsedStatus.startedAt,
          errors: parsedStatus.errors,
          lastCommitSha: parsedStatus.lastCommitSha,
        };

        repositories.push(status);
      } catch (error) {
        console.error(`Error processing repository status for ${key}:`, error);
        // Continue processing other repositories
      }
    }

    // Sort by most recently processed
    repositories.sort((a, b) => b.lastProcessedAt - a.lastProcessedAt);

    console.log(
      `Found ${repositories.length} repositories from ${keys.length} keys`
    );

    return res.status(200).json({
      repositories,
      totalCount: repositories.length,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Error retrieving embedding status:', error);
    return res.status(500).json({
      error: 'Failed to retrieve embedding status',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

// Export the handler with internal access protection
export default withInternalAccess(handler);
