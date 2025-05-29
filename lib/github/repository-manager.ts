import { Redis } from '@upstash/redis';
import { env } from '../env.js';
import {
  getFileContent,
  searchCode as githubSearchCode,
  createBranch,
  createOrUpdateFile,
  createPullRequest,
  getDirectoryStructure,
} from './github-utils.js';

interface SearchResult {
  path: string;
  content: string;
  score?: number;
  metadata?: {
    startLine: number;
    endLine: number;
    language: string;
    type: string;
    name?: string;
  };
}

/**
 * Enhanced Repository Manager that combines GitHub operations with vector search capabilities
 */
export class RepositoryManager {
  private redis: Redis;
  private allowedRepositories: string[];

  // Simple caches for performance
  private fileCache: Map<string, { content: string; timestamp: number }> =
    new Map();
  private searchCache: Map<
    string,
    { results: SearchResult[]; timestamp: number }
  > = new Map();

  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(allowedRepositories: string[] = []) {
    this.redis = new Redis({
      url: env.KV_REST_API_URL,
      token: env.KV_REST_API_TOKEN,
    });
    this.allowedRepositories = allowedRepositories;
  }

  /**
   * Verify repository access
   */
  private async verifyRepoAccess(repository: string): Promise<void> {
    if (
      this.allowedRepositories.length > 0 &&
      !this.allowedRepositories.includes(repository)
    ) {
      throw new Error(`Repository ${repository} is not in the allowed list`);
    }
  }

  /**
   * Search code in a repository using vector embeddings if available, fallback to GitHub API
   */
  async searchCode(
    query: string,
    repository: string,
    options: {
      fileFilter?: string;
      maxResults?: number;
    } = {}
  ): Promise<SearchResult[]> {
    await this.verifyRepoAccess(repository);

    const cacheKey = `search:${repository}:${query}:${JSON.stringify(options)}`;
    const cached = this.searchCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.results;
    }

    try {
      // Check if repository is embedded
      const isEmbedded = await this.isRepositoryEmbedded(repository);

      let results: SearchResult[];

      if (isEmbedded) {
        console.log(`Using vector search for repository: ${repository}`);
        results = await this.searchWithVectorEmbeddings(
          query,
          repository,
          options
        );
      } else {
        console.log(
          `Using GitHub API search for repository: ${repository} (not embedded)`
        );
        results = await this.searchWithGitHubAPI(query, repository, options);
      }

      // Cache results
      this.searchCache.set(cacheKey, { results, timestamp: Date.now() });
      return results;
    } catch (error) {
      console.error(`Error searching in repository ${repository}:`, error);
      throw error;
    }
  }

  /**
   * Get file content (uses existing github-utils function with caching)
   */
  async getFileContent(
    path: string,
    repository: string,
    startLine: number = 1,
    maxLines: number = 200,
    branch?: string
  ): Promise<string> {
    await this.verifyRepoAccess(repository);

    const cacheKey = `file:${repository}:${path}:${startLine}:${maxLines}:${
      branch || 'default'
    }`;
    const cached = this.fileCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.content;
    }

    try {
      const content = await getFileContent(
        path,
        repository,
        startLine,
        maxLines,
        branch
      );

      // Cache the content
      this.fileCache.set(cacheKey, { content, timestamp: Date.now() });
      return content;
    } catch (error) {
      console.error(
        `Error getting file content for ${path} in ${repository}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Create a branch (delegates to github-utils)
   */
  async createBranch(
    branch: string,
    repository: string,
    baseBranch?: string
  ): Promise<void> {
    await this.verifyRepoAccess(repository);
    return createBranch(branch, repository, baseBranch);
  }

  /**
   * Create or update a file (delegates to github-utils)
   */
  async createOrUpdateFile(
    path: string,
    content: string,
    message: string,
    repository: string,
    branch: string
  ): Promise<void> {
    await this.verifyRepoAccess(repository);
    return createOrUpdateFile(path, content, message, repository, branch);
  }

  /**
   * Create a pull request (delegates to github-utils)
   */
  async createPullRequest(
    title: string,
    body: string,
    head: string,
    base: string,
    repository: string
  ): Promise<{ url: string; number: number }> {
    await this.verifyRepoAccess(repository);
    return createPullRequest(title, body, head, base, repository);
  }

  /**
   * Get directory structure (delegates to github-utils)
   */
  async getDirectoryStructure(
    repository: string,
    directoryPath: string = ''
  ): Promise<
    Array<{ name: string; path: string; type: 'file' | 'dir'; size?: number }>
  > {
    await this.verifyRepoAccess(repository);
    return getDirectoryStructure(repository, directoryPath);
  }

  /**
   * Clear all caches
   */
  cleanup(): void {
    this.fileCache.clear();
    this.searchCache.clear();
  }

  /**
   * Check if repository has embeddings
   */
  private async isRepositoryEmbedded(repository: string): Promise<boolean> {
    try {
      const statusKey = `embedding:repo:${repository}:status`;
      const status = await this.redis.get(statusKey);

      if (!status) {
        return false;
      }

      const parsedStatus =
        typeof status === 'string' ? JSON.parse(status) : status;
      return parsedStatus.status === 'completed';
    } catch (error) {
      console.error(
        `Error checking if repository ${repository} is embedded:`,
        error
      );
      return false;
    }
  }

  /**
   * Search using vector embeddings
   */
  private async searchWithVectorEmbeddings(
    query: string,
    repository: string,
    options: {
      fileFilter?: string;
      maxResults?: number;
    }
  ): Promise<SearchResult[]> {
    try {
      // Get query embedding
      const queryEmbedding = await this.getQueryEmbedding(query);

      // Get all chunks for the repository
      const chunksKey = `embedding:repo:${repository}:chunks`;
      const chunks = await this.redis.lrange(chunksKey, 0, -1);

      if (!chunks || chunks.length === 0) {
        console.log(`No chunks found for repository ${repository}`);
        return [];
      }

      const results: Array<SearchResult & { score: number }> = [];

      // Calculate similarity for each chunk
      for (const chunkData of chunks) {
        try {
          const chunk =
            typeof chunkData === 'string' ? JSON.parse(chunkData) : chunkData;

          if (!chunk.embedding) {
            continue;
          }

          // Apply file filter if specified
          if (options.fileFilter && !chunk.path.includes(options.fileFilter)) {
            continue;
          }

          // Calculate cosine similarity
          const similarity = this.cosineSimilarity(
            queryEmbedding,
            chunk.embedding
          );

          if (similarity > 0.1) {
            // Minimum similarity threshold
            results.push({
              path: chunk.path,
              content: chunk.content,
              score: similarity,
              metadata: chunk.metadata,
            });
          }
        } catch (error) {
          console.error('Error processing chunk:', error);
          continue;
        }
      }

      // Sort by similarity score (descending)
      results.sort((a, b) => b.score - a.score);

      // Limit results
      const maxResults = options.maxResults || 10;
      return results.slice(0, maxResults);
    } catch (error) {
      console.error(
        `Error in vector search for repository ${repository}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Search using GitHub API (fallback)
   */
  private async searchWithGitHubAPI(
    query: string,
    repository: string,
    options: {
      fileFilter?: string;
      maxResults?: number;
    }
  ): Promise<SearchResult[]> {
    try {
      const githubResults = await githubSearchCode(query, repository, options);

      // Convert GitHub API results to our format
      return githubResults.map((result) => ({
        path: result.path,
        content: result.content,
        metadata: {
          startLine: result.line || 1,
          endLine: result.line || 1,
          language: 'unknown',
          type: 'file',
        },
      }));
    } catch (error) {
      console.error(
        `Error in GitHub API search for repository ${repository}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get embedding for a query using OpenAI API
   */
  private async getQueryEmbedding(query: string): Promise<number[]> {
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
          dimensions: 256,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
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
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }
}
