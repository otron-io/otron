import { Redis } from '@upstash/redis';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { env } from '../src/env.js';
import { withInternalAccess } from '../src/auth.js';

// Initialize Redis
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

// Maximum search results to return
const MAX_RESULTS = 10;

// Redis key structure for embeddings
const getChunkKey = (repo: string) => `embedding:repo:${repo}:chunks`;
const getRepoKey = (repo: string) => `embedding:repo:${repo}:status`;

// Interface for code chunks with embeddings
interface CodeChunk {
  repository: string;
  path: string;
  content: string;
  embedding: number[];
  metadata: {
    language: string;
    type: 'function' | 'class' | 'method' | 'block' | 'file';
    name?: string;
    startLine: number;
    endLine: number;
    lineCount: number;
  };
}

// Interface for search results
interface SearchResult {
  repository: string;
  path: string;
  content: string;
  score: number;
  language: string;
  type: string;
  name?: string;
  startLine: number;
  endLine: number;
  lineCount: number;
}

/**
 * Get embedding for a text query using OpenAI API
 */
async function getQueryEmbedding(query: string): Promise<number[]> {
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: query,
        dimensions: 256, // Must match the dimension used for code embeddings
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI API error: ${JSON.stringify(error)}`);
    }

    const result = await response.json();
    return result.data[0].embedding;
  } catch (error) {
    console.error('Error creating query embedding:', error);
    throw error;
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have the same dimensions');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  // Handle edge case of zero-length vectors
  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Search for code chunks that match the query embedding
 */
async function searchCodeChunks(
  repository: string,
  queryEmbedding: number[],
  limit: number = MAX_RESULTS,
  fileFilter?: string
): Promise<SearchResult[]> {
  // Get all chunks for the repository
  const allChunks = await redis.lrange(getChunkKey(repository), 0, -1);

  if (!allChunks || allChunks.length === 0) {
    return [];
  }

  // Parse chunks and calculate similarity scores
  const chunks: CodeChunk[] = allChunks.map((chunk) => JSON.parse(chunk));
  const results: SearchResult[] = [];

  for (const chunk of chunks) {
    // Skip if no embedding
    if (!chunk.embedding) continue;

    // Apply file filter if specified
    if (fileFilter && !chunk.path.includes(fileFilter)) {
      continue;
    }

    // Calculate similarity score
    const score = cosineSimilarity(queryEmbedding, chunk.embedding);

    // Add to results
    results.push({
      repository: chunk.repository,
      path: chunk.path,
      content: chunk.content,
      score,
      language: chunk.metadata.language,
      type: chunk.metadata.type,
      name: chunk.metadata.name,
      startLine: chunk.metadata.startLine,
      endLine: chunk.metadata.endLine,
      lineCount: chunk.metadata.lineCount,
    });
  }

  // Sort by similarity score (highest first)
  results.sort((a, b) => b.score - a.score);

  // Return top results
  return results.slice(0, limit);
}

/**
 * Check if a repository has been embedded
 */
async function isRepositoryEmbedded(repository: string): Promise<boolean> {
  console.log(`Checking if repository '${repository}' is embedded...`);

  try {
    // Get the key for the repository status
    const repoKey = getRepoKey(repository);
    console.log(`Repository key: ${repoKey}`);

    // Check if there's a status entry for this repository
    const repoStatus = await redis.get(repoKey);
    console.log(
      `Repository status raw for ${repository}: ${
        repoStatus === null
          ? 'null'
          : typeof repoStatus === 'string'
          ? repoStatus
          : JSON.stringify(repoStatus)
      }`
    );

    // Special case debugging for 3DHubs repository
    if (repository.includes('3DHubs')) {
      console.log('🔍 Found 3DHubs repository query');

      // List all keys that might match this repository
      const allKeys = await redis.keys('embedding:repo:*3DHubs*');
      console.log(`All 3DHubs related keys (${allKeys.length}):`, allKeys);

      // Check for chunks directly
      const chunkKey = getChunkKey(repository);
      const chunkCount = await redis.llen(chunkKey);
      console.log(`Checking chunks at ${chunkKey}: ${chunkCount} chunks found`);

      if (chunkCount > 0) {
        // Get a sample chunk to verify content
        const sampleChunk = await redis.lindex(chunkKey, 0);
        console.log(`Sample chunk exists: ${!!sampleChunk}`);

        // If we have chunks but status is missing, let's consider it embedded
        if (!repoStatus && chunkCount > 0) {
          console.log(
            `No status found but ${chunkCount} chunks exist - considering repository as embedded`
          );
          return true;
        }
      }
    }

    if (!repoStatus) {
      console.log(`No status found for repository ${repository}`);
      return false;
    }

    // Try to parse the status
    try {
      const status =
        typeof repoStatus === 'object'
          ? repoStatus
          : JSON.parse(repoStatus as string);

      console.log(
        `Repository status parsed: ${JSON.stringify(status, null, 2)}`
      );

      // Check for chunks to verify the repository actually has content
      const chunkCount = await redis.llen(getChunkKey(repository));
      console.log(`Repository chunk count: ${chunkCount}`);

      // More lenient check - either status is completed or we have chunks
      const isComplete = status.status === 'completed';
      const hasChunks = chunkCount > 0;

      console.log(
        `Repository ${repository} status check: isComplete=${isComplete}, hasChunks=${hasChunks}`
      );

      // If we have chunks, consider it embedded even if status isn't "completed"
      return hasChunks;
    } catch (parseError) {
      console.error(
        `Error parsing status for repository ${repository}:`,
        parseError
      );

      // Check if we have chunks anyway
      const chunkCount = await redis.llen(getChunkKey(repository));
      if (chunkCount > 0) {
        console.log(
          `Status parsing failed but found ${chunkCount} chunks - considering repository as embedded`
        );
        return true;
      }

      return false;
    }
  } catch (error) {
    console.error(
      `Error checking repository embedding status for ${repository}:`,
      error
    );
    return false;
  }
}

/**
 * Main handler for the code search endpoint
 */
async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Extract parameters from the request
  const {
    method,
    rawRepository,
    query,
    fileFilter,
    limit = MAX_RESULTS,
  } = req.body || {};

  // Add detailed logging of all incoming parameters
  console.log(`Search request received:`, {
    method,
    repository: rawRepository,
    query,
    fileFilter,
    limit,
    headers: req.headers['x-vercel-id']
      ? `trace: ${req.headers['x-vercel-id']}`
      : undefined,
  });

  // Input validation
  if (!rawRepository || typeof rawRepository !== 'string') {
    return res.status(400).json({ error: 'Repository parameter is required' });
  }

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Search query is required' });
  }

  if (!method || method !== 'vector') {
    return res
      .status(400)
      .json({ error: 'Only vector search method is supported' });
  }

  // Normalize repository name (trim whitespace, remove status suffix if present)
  const repository = rawRepository.trim().replace(/\s*\(.*\)$/, '');
  console.log(
    `Original repository: '${rawRepository}', normalized to: '${repository}'`
  );

  try {
    // Check if repository is embedded before processing
    const isEmbedded = await isRepositoryEmbedded(repository);
    console.log(`Repository ${repository} embedded status: ${isEmbedded}`);

    if (!isEmbedded) {
      // For debugging, let's list what repositories we do have
      try {
        const allRepoKeys = await redis.keys('embedding:repo:*:status');
        const availableRepos = allRepoKeys
          .map((key) =>
            key.replace('embedding:repo:', '').replace(':status', '')
          )
          .filter(Boolean);

        console.log(
          `Repository ${repository} not embedded. Available repositories:`,
          availableRepos
        );

        return res.status(404).json({
          error: 'Repository not embedded',
          available: availableRepos,
        });
      } catch (keysError) {
        console.error('Error getting available repositories:', keysError);
        return res.status(404).json({ error: 'Repository not embedded' });
      }
    }

    // Get query embedding
    const queryEmbedding = await getQueryEmbedding(query);

    // Search code chunks
    const results = await searchCodeChunks(
      repository,
      queryEmbedding,
      Number(limit),
      fileFilter
    );

    return res.status(200).json({ results });
  } catch (error) {
    console.error(`Error in search:`, error);
    return res.status(500).json({
      error: 'Search failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

// Export with internal access protection
export default withInternalAccess(handler);
