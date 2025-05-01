import { Redis } from '@upstash/redis';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { env } from '../src/env.js';

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
  const repoStatus = await redis.get(getRepoKey(repository));

  if (!repoStatus) return false;

  try {
    const status = JSON.parse(repoStatus as string);
    return status.status === 'completed';
  } catch (error) {
    return false;
  }
}

/**
 * Main handler for the code search endpoint
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept GET or POST requests
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Extract search parameters
  const params = req.method === 'GET' ? req.query : req.body;
  const { repository, query, fileFilter, limit = MAX_RESULTS } = params;

  if (!repository || typeof repository !== 'string') {
    return res
      .status(400)
      .json({ error: 'Missing or invalid repository parameter' });
  }

  if (!query || typeof query !== 'string') {
    return res
      .status(400)
      .json({ error: 'Missing or invalid query parameter' });
  }

  try {
    // Check if repository has been embedded
    const isEmbedded = await isRepositoryEmbedded(repository);

    if (!isEmbedded) {
      return res.status(404).json({
        error: 'Repository not embedded',
        message: `Repository ${repository} has not been embedded yet. Please run the embedding process first.`,
        embedUrl: `/api/embed-repo`,
      });
    }

    // Get query embedding
    const queryEmbedding = await getQueryEmbedding(query);

    // Search for matching code chunks
    const results = await searchCodeChunks(
      repository,
      queryEmbedding,
      Math.min(parseInt(limit as string) || MAX_RESULTS, 50),
      fileFilter as string
    );

    // Return results
    return res.status(200).json({
      repository,
      query,
      results,
      totalResults: results.length,
      searchTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error searching code:', error);

    return res.status(500).json({
      error: 'Search failed',
      message: `Error searching code: ${error}`,
    });
  }
}
