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
   * Check if repository has embeddings (uses same logic as code-search API)
   */
  private async isRepositoryEmbedded(repository: string): Promise<boolean> {
    try {
      const statusKey = `embedding:repo:${repository}:status`;
      const status = await this.redis.get(statusKey);

      if (!status) {
        // Check if we have chunks anyway
        const chunkKey = `embedding:repo:${repository}:chunks`;
        const chunkCount = await this.redis.llen(chunkKey);
        return chunkCount > 0;
      }

      try {
        const parsedStatus =
          typeof status === 'object' ? status : JSON.parse(status as string);

        // Check for chunks to verify the repository actually has content
        const chunkKey = `embedding:repo:${repository}:chunks`;
        const chunkCount = await this.redis.llen(chunkKey);

        // More lenient check - either status is completed or we have chunks
        const isComplete = parsedStatus.status === 'completed';
        const hasChunks = chunkCount > 0;

        // If we have chunks, consider it embedded even if status isn't "completed"
        return hasChunks;
      } catch (parseError) {
        console.error(
          `Error parsing status for repository ${repository}:`,
          parseError
        );

        // Check if we have chunks anyway
        const chunkKey = `embedding:repo:${repository}:chunks`;
        const chunkCount = await this.redis.llen(chunkKey);
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
        `Error checking if repository ${repository} is embedded:`,
        error
      );
      return false;
    }
  }

  /**
   * Search using vector embeddings (now delegates to code-search API)
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
      // Call the code-search API directly
      const searchParams = new URLSearchParams({
        repository,
        query,
        method: 'vector',
        limit: (options.maxResults || 10).toString(),
      });

      if (options.fileFilter) {
        searchParams.append('fileFilter', options.fileFilter);
      }

      // Make internal API call to code-search endpoint
      const baseUrl = env.VERCEL_URL || 'http://localhost:3000';

      const response = await fetch(
        `${baseUrl}/api/code-search?${searchParams}`,
        {
          method: 'GET',
          headers: {
            'X-Internal-Token': env.INTERNAL_API_TOKEN,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Code search API error: ${response.status} - ${
            errorData.error || response.statusText
          }`
        );
      }

      const data = await response.json();

      // Convert API response to our SearchResult format
      return data.results.map((result: any) => ({
        path: result.path,
        content: result.content,
        score: result.score,
        metadata: {
          startLine: result.startLine,
          endLine: result.endLine,
          language: result.language,
          type: result.type,
          name: result.name,
        },
      }));
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
}
