import { Redis } from '@upstash/redis';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { env } from '../src/env.js';
import { withInternalAccess } from '../src/auth.js';

// Initialize Redis
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

// Configuration constants
const EMBEDDING_MODEL = 'text-embedding-3-small';
const MAX_RESULTS = 10;
const SIMILARITY_THRESHOLD = 0.4; // Lower threshold from 0.7 to 0.4 to get more results

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
 * Search for code chunks in a repository using vector similarity
 */
async function searchCodeChunks(
  repository: string,
  queryEmbedding: number[],
  limit: number = MAX_RESULTS,
  fileFilter?: string
): Promise<SearchResult[]> {
  console.log(
    `Searching code chunks in ${repository} with limit ${limit}${
      fileFilter ? ` and filter ${fileFilter}` : ''
    }`
  );

  try {
    // Get chunk key for the repository
    const chunkKey = getChunkKey(repository);

    // Get the list length (number of chunks)
    const chunkCount = await redis.llen(chunkKey);
    console.log(`Found ${chunkCount} chunks for ${repository}`);

    if (chunkCount === 0) {
      console.log(`No chunks found for repository ${repository}`);
      return [];
    }

    // Get all chunks
    const chunks = await redis.lrange(chunkKey, 0, -1);
    console.log(`Retrieved ${chunks.length} chunks from Redis`);

    // Get a sample chunk for debugging
    if (chunks.length > 0) {
      const sampleChunk = chunks[0];
      console.log(`Sample chunk type: ${typeof sampleChunk}`);
      console.log(
        `Sample chunk preview: ${
          typeof sampleChunk === 'string'
            ? sampleChunk.substring(0, 100)
            : JSON.stringify(sampleChunk).substring(0, 100)
        }...`
      );
    }

    // Filter and score chunks
    const results: SearchResult[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Skip if chunk is null or empty
      if (!chunk) continue;

      // Parse the chunk
      let parsedChunk: CodeChunk;
      try {
        // Check if chunk is already an object
        if (typeof chunk === 'object' && chunk !== null) {
          parsedChunk = chunk as unknown as CodeChunk;
        } else if (typeof chunk === 'string') {
          // Handle string representation of an object
          if (chunk === '[object Object]') {
            console.error(
              `Chunk ${i} is corrupted with '[object Object]' string representation`
            );
            continue;
          }
          parsedChunk = JSON.parse(chunk);
        } else {
          console.error(`Chunk ${i} has unexpected type: ${typeof chunk}`);
          continue;
        }

        // Validate chunk has required fields
        if (
          !parsedChunk.repository ||
          !parsedChunk.path ||
          !parsedChunk.embedding
        ) {
          console.error(
            `Chunk ${i} is missing required fields:`,
            `repository: ${!!parsedChunk.repository}, `,
            `path: ${!!parsedChunk.path}, `,
            `embedding: ${!!parsedChunk.embedding}`
          );
          continue;
        }
      } catch (e) {
        console.error(`Error parsing chunk ${i}: ${e}`);
        console.error(
          `Problematic chunk content: ${
            typeof chunk === 'string'
              ? chunk.substring(0, 200)
              : 'non-string chunk'
          }`
        );
        continue;
      }

      // Apply file filter if provided
      if (fileFilter && !matchesFileFilter(parsedChunk.path, fileFilter)) {
        continue;
      }

      // Calculate similarity score
      const similarity = cosineSimilarity(
        queryEmbedding,
        parsedChunk.embedding
      );

      // Only include results above the threshold
      if (similarity > SIMILARITY_THRESHOLD) {
        results.push({
          repository: parsedChunk.repository,
          path: parsedChunk.path,
          content: parsedChunk.content,
          score: similarity,
          language: parsedChunk.metadata?.language || 'unknown',
          type: parsedChunk.metadata?.type || 'block',
          name: parsedChunk.metadata?.name,
          startLine: parsedChunk.metadata?.startLine || 0,
          endLine: parsedChunk.metadata?.endLine || 0,
          lineCount: parsedChunk.metadata?.lineCount || 0,
        });
      }
    }

    // Sort by similarity score (highest first)
    results.sort((a, b) => b.score - a.score);

    console.log(
      `Found ${results.length} results above threshold ${SIMILARITY_THRESHOLD}`
    );

    // Return top results based on limit
    return results.slice(0, limit);
  } catch (error) {
    console.error(`Error searching code chunks for ${repository}:`, error);
    throw error;
  }
}

/**
 * Check if a file path matches a filter pattern
 */
function matchesFileFilter(path: string, filter: string): boolean {
  // Convert glob pattern to regex
  const pattern = filter
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${pattern}$`);
  return regex.test(path);
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
  // Accept both GET and POST requests
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Extract parameters from the request - support both query params and body
  const params = req.method === 'GET' ? req.query : req.body || {};

  // Log raw request details for debugging
  console.log(`Request details:`, {
    method: req.method,
    url: req.url,
    headers: req.headers,
    query: req.query,
    body: req.body,
  });

  console.log(`Raw params received:`, params);

  const {
    method = 'vector',
    repository,
    rawRepository,
    query,
    fileFilter,
    limit = MAX_RESULTS,
  } = params;

  // Add detailed logging of all incoming parameters
  console.log(`Search request received:`, {
    requestMethod: req.method,
    searchMethod: method,
    repository: repository || rawRepository,
    query,
    fileFilter,
    limit,
    headers: req.headers['x-vercel-id']
      ? `trace: ${req.headers['x-vercel-id']}`
      : undefined,
  });

  // Input validation - support both repository and rawRepository parameter names
  const repoParam = rawRepository || repository;
  if (!repoParam || typeof repoParam !== 'string') {
    return res.status(400).json({
      error: 'Repository parameter is required',
      providedParams: Object.keys(params),
    });
  }

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Search query is required' });
  }

  if (method !== 'vector') {
    return res
      .status(400)
      .json({ error: 'Only vector search method is supported' });
  }

  // Normalize repository name (trim whitespace, remove status suffix if present)
  const repositoryName = repoParam.trim().replace(/\s*\(.*\)$/, '');
  console.log(
    `Original repository: '${repoParam}', normalized to: '${repositoryName}'`
  );

  try {
    // Check if repository is embedded before processing
    const isEmbedded = await isRepositoryEmbedded(repositoryName);
    console.log(`Repository ${repositoryName} embedded status: ${isEmbedded}`);

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
          `Repository ${repositoryName} not embedded. Available repositories:`,
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
      repositoryName,
      queryEmbedding,
      Number(limit),
      typeof fileFilter === 'string' ? fileFilter : undefined
    );

    return res.status(200).json({
      repository: repositoryName,
      query,
      results,
      totalResults: results.length,
      searchTime: new Date().toISOString(),
    });
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
