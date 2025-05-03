import { Octokit } from '@octokit/rest';
import { env } from './env.js';
import { GitHubAppService } from './github-app.js';
import { Redis } from '@upstash/redis';

/**
 * A simplified repository manager that uses only GitHub API operations.
 * This class provides code search, file content retrieval, and PR creation
 * capabilities while ensuring fast operations suitable for serverless environments.
 */
export class LocalRepositoryManager {
  private octokit: Octokit;
  private githubAppService: GitHubAppService | null = null;
  private allowedRepositories: string[];
  private redis: Redis;

  // Simple cache objects
  private fileCache: Map<string, { content: string; timestamp: number }> =
    new Map();
  private searchCache: Map<string, { results: any[]; timestamp: number }> =
    new Map();

  // Extended context cache for better search
  private contextCache: Map<
    string,
    {
      fileType: string;
      imports: string[];
      functions: string[];
      classes: string[];
      timestamp: number;
    }
  > = new Map();

  // Cache TTL values in milliseconds
  private readonly CACHE_TTL = {
    FILE: 5 * 60 * 1000, // 5 minutes
    SEARCH: 2 * 60 * 1000, // 2 minutes
    CONTEXT: 30 * 60 * 1000, // 30 minutes
  };

  // Common code extensions and their language
  private readonly CODE_EXTENSIONS: Record<string, string> = {
    '.js': 'javascript',
    '.ts': 'typescript',
    '.py': 'python',
    '.java': 'java',
    '.go': 'go',
    '.rb': 'ruby',
    '.php': 'php',
    '.c': 'c',
    '.cpp': 'cpp',
    '.cs': 'csharp',
    '.html': 'html',
    '.css': 'css',
    '.jsx': 'jsx',
    '.tsx': 'tsx',
  };

  /**
   * Creates a new repository manager
   */
  constructor(allowedRepositories: string[] = []) {
    this.allowedRepositories = allowedRepositories;

    // Initialize GitHub client - only GitHub App auth is supported
    if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY) {
      this.githubAppService = GitHubAppService.getInstance();
      // Temporary Octokit that will be replaced with app-specific clients
      this.octokit = new Octokit();
    } else {
      throw new Error(
        'GitHub App authentication is required. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY.'
      );
    }

    // Parse allowed repos from env if not provided
    if (this.allowedRepositories.length === 0 && env.ALLOWED_REPOSITORIES) {
      this.allowedRepositories = env.ALLOWED_REPOSITORIES.split(',').map((r) =>
        r.trim()
      );
    }

    console.log(
      `Repository manager initialized with ${this.allowedRepositories.length} allowed repositories`
    );

    // Initialize Redis client
    this.redis = new Redis({
      url: env.KV_REST_API_URL,
      token: env.KV_REST_API_TOKEN,
    });
  }

  /**
   * Get the appropriate Octokit client for a repository
   */
  private async getOctokitForRepo(repository: string): Promise<Octokit> {
    if (this.githubAppService) {
      return this.githubAppService.getOctokitForRepo(repository);
    }
    return this.octokit;
  }

  /**
   * Verify access to a repository
   */
  private async verifyRepoAccess(repository: string): Promise<void> {
    // Check if repo is allowed
    if (
      this.allowedRepositories.length > 0 &&
      !this.allowedRepositories.includes(repository)
    ) {
      throw new Error(`Repository ${repository} is not in the allowed list`);
    }

    try {
      const [owner, repo] = repository.split('/');
      const octokit = await this.getOctokitForRepo(repository);

      // Attempt to access the repo
      await octokit.repos.get({ owner, repo });
    } catch (error: any) {
      if (error.status === 401) {
        throw new Error(
          `Authentication error for ${repository}. Check GitHub app installation.`
        );
      } else if (error.status === 404) {
        throw new Error(`Repository ${repository} not found or no access`);
      }
      throw error;
    }
  }

  /**
   * Search for code in a repository using GitHub search API
   * with effective timeouts and reliable results
   */
  async searchCode(
    query: string,
    repository: string,
    options: {
      contextAware?: boolean;
      semanticBoost?: boolean;
      fileFilter?: string;
      maxResults?: number;
    } = {}
  ): Promise<
    Array<{ path: string; line: number; content: string; context?: string }>
  > {
    try {
      await this.verifyRepoAccess(repository);

      // Check if vector embeddings are available
      const isEmbedded = await this.isRepositoryEmbedded(repository);

      if (isEmbedded) {
        console.log(`Using vector embeddings for repository ${repository}`);
        return this.searchWithVectorEmbeddings(query, repository, {
          fileFilter: options.fileFilter,
          maxResults: options.maxResults || 10,
        });
      }

      // Instead of falling back to GitHub API, return an informative message
      console.log(
        `No embeddings available for ${repository}, returning informative message`
      );
      return [
        {
          path: 'embedding-required.txt',
          line: 1,
          content: `Repository ${repository} needs to be embedded before it can be searched. Please run the embedding process first.`,
        },
      ];
    } catch (error) {
      console.error(`Error searching for "${query}" in ${repository}:`, error);
      // Return empty results with a message
      return [
        {
          path: 'search-error.txt',
          line: 1,
          content: `Search could not be completed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ];
    }
  }

  /**
   * Get file content with timeout
   */
  private async getFileContentWithTimeout(
    path: string,
    repository: string,
    timeoutMs: number,
    startLine: number = 1,
    maxLines: number = 200,
    branch?: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout fetching ${path} after ${timeoutMs}ms`));
      }, timeoutMs);

      this.getFileContent(path, repository, startLine, maxLines, branch)
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Get the content of a file from GitHub, optionally limited to a range of lines
   */
  async getFileContent(
    path: string,
    repository: string,
    startLine: number = 1,
    maxLines: number = 200,
    branch?: string
  ): Promise<string> {
    try {
      // Check if allowed repository
      await this.verifyRepoAccess(repository);

      // Validate line ranges
      if (startLine < 1) {
        startLine = 1; // Ensure startLine is at least 1
      }
      if (maxLines > 200) {
        maxLines = 200; // Cap the maximum lines to 200
      }

      // Check cache for full file content
      const cacheKey = `${repository}:${path}:${branch || 'default'}`;
      const cached = this.fileCache.get(cacheKey);

      // If we have a cached version and it's still valid, use it
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL.FILE) {
        console.log(
          `Using cached content for ${path} in ${repository}${
            branch ? ` (branch: ${branch})` : ''
          }`
        );
        const allLines = cached.content.split('\n');
        const totalLines = allLines.length;

        // Extract the requested line range
        const endLine = Math.min(startLine + maxLines - 1, totalLines);
        const requestedLines = allLines.slice(startLine - 1, endLine);

        // Return the requested lines with metadata
        const lineInfo = `// Lines ${startLine}-${endLine} of ${totalLines}\n`;
        return lineInfo + requestedLines.join('\n');
      }

      // Fetch file content
      console.log(
        `Fetching content of ${path} from ${repository}${
          branch ? ` (branch: ${branch})` : ''
        }`
      );
      const [owner, repo] = repository.split('/');
      const octokit = await this.getOctokitForRepo(repository);

      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path,
        ref: branch, // Use the specified branch or default if not provided
      });

      if (!('content' in data) || typeof data.content !== 'string') {
        throw new Error(`Unexpected response format for ${path}`);
      }

      // Decode base64 content
      const content = Buffer.from(data.content, 'base64').toString('utf-8');

      // Cache the full content
      this.fileCache.set(cacheKey, {
        content,
        timestamp: Date.now(),
      });

      // Split into lines and extract the requested range
      const allLines = content.split('\n');
      const totalLines = allLines.length;
      const endLine = Math.min(startLine + maxLines - 1, totalLines);

      // Extract just the requested lines
      const requestedLines = allLines.slice(startLine - 1, endLine);

      // Return the requested lines with metadata
      const lineInfo = `// Lines ${startLine}-${endLine} of ${totalLines}\n`;
      return lineInfo + requestedLines.join('\n');
    } catch (error: any) {
      console.error(
        `Error getting file content for ${path} from ${repository}${
          branch ? ` (branch: ${branch})` : ''
        }:`,
        error
      );

      if (error.status === 404) {
        return `# File not found: ${path}${
          branch ? ` (branch: ${branch})` : ''
        }`;
      }

      return `# Error retrieving content for ${path}${
        branch ? ` (branch: ${branch})` : ''
      }`;
    }
  }

  /**
   * Create a branch in the repository
   */
  async createBranch(
    branch: string,
    repository: string,
    baseBranch?: string
  ): Promise<void> {
    const [owner, repo] = repository.split('/');

    try {
      await this.verifyRepoAccess(repository);
      const octokit = await this.getOctokitForRepo(repository);

      // Get base branch if not provided
      const baseRef = baseBranch || (await this.getDefaultBranch(repository));

      // Get SHA of latest commit on base branch
      const { data: refData } = await octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${baseRef}`,
      });

      // Create new branch
      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha: refData.object.sha,
      });

      console.log(`Created branch ${branch} in ${repository}`);
    } catch (error) {
      console.error(`Error creating branch ${branch} in ${repository}:`, error);
      throw error;
    }
  }

  /**
   * Get the default branch of a repository
   */
  async getDefaultBranch(repository: string): Promise<string> {
    const [owner, repo] = repository.split('/');

    try {
      const octokit = await this.getOctokitForRepo(repository);
      const { data } = await octokit.repos.get({ owner, repo });
      return data.default_branch;
    } catch (error) {
      console.error(`Error getting default branch for ${repository}:`, error);
      return 'main'; // Fallback to main
    }
  }

  /**
   * Create or update a file in a repository
   */
  async createOrUpdateFile(
    path: string,
    content: string,
    message: string,
    repository: string,
    branch: string
  ): Promise<void> {
    const [owner, repo] = repository.split('/');

    try {
      await this.verifyRepoAccess(repository);
      const octokit = await this.getOctokitForRepo(repository);

      // Check if file exists to get SHA
      let sha: string | undefined;
      try {
        const { data } = await octokit.repos.getContent({
          owner,
          repo,
          path,
          ref: branch,
        });

        if ('sha' in data) {
          sha = data.sha;
        }
      } catch (error) {
        // File doesn't exist yet, which is fine
      }

      // Create or update file
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message,
        content: Buffer.from(content).toString('base64'),
        branch,
        sha,
      });

      console.log(`File ${path} updated in ${repository}/${branch}`);

      // Clear cache for this file
      const cacheKey = `${repository}:${path}:${branch}`;
      this.fileCache.delete(cacheKey);

      // Also clear the default branch cache entry if exists
      const defaultCacheKey = `${repository}:${path}:default`;
      this.fileCache.delete(defaultCacheKey);
    } catch (error) {
      console.error(
        `Error updating file ${path} in ${repository}/${branch}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Create a pull request
   */
  async createPullRequest(
    title: string,
    body: string,
    head: string,
    base: string,
    repository: string
  ): Promise<{ url: string }> {
    const [owner, repo] = repository.split('/');

    try {
      await this.verifyRepoAccess(repository);
      const octokit = await this.getOctokitForRepo(repository);

      const { data } = await octokit.pulls.create({
        owner,
        repo,
        title,
        body,
        head,
        base,
      });

      console.log(`Created pull request #${data.number} in ${repository}`);
      return { url: data.html_url };
    } catch (error) {
      console.error(`Error creating pull request in ${repository}:`, error);
      throw error;
    }
  }

  /**
   * Clear all caches
   */
  cleanup(): void {
    this.fileCache.clear();
    this.searchCache.clear();
    this.contextCache.clear();
    console.log('Cleared all caches');
  }

  /**
   * Get the directory structure of a repository or specific path
   * Returns a list of files and directories at the specified path
   */
  async getDirectoryStructure(
    repository: string,
    directoryPath: string = ''
  ): Promise<
    Array<{ name: string; path: string; type: 'file' | 'dir'; size?: number }>
  > {
    try {
      // Verify repository access
      await this.verifyRepoAccess(repository);

      // Generate a cache key
      const cacheKey = `dir:${repository}:${directoryPath}`;

      // Check cache
      const cached = this.searchCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL.SEARCH) {
        return cached.results;
      }

      console.log(
        `Getting directory structure for ${
          directoryPath || '/'
        } in ${repository}`
      );

      const [owner, repo] = repository.split('/');
      const octokit = await this.getOctokitForRepo(repository);

      // Set a timeout for the API request
      const contentPromise = octokit.repos.getContent({
        owner,
        repo,
        path: directoryPath, // Empty string works for root directory
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error('Directory listing timed out')),
          5000
        );
      });

      // Race between content fetch and timeout
      const { data } = (await Promise.race([
        contentPromise,
        timeoutPromise,
      ])) as any;

      // Process the results
      let result: Array<{
        name: string;
        path: string;
        type: 'file' | 'dir';
        size?: number;
      }> = [];

      if (Array.isArray(data)) {
        // It's a directory
        result = data.map((item) => ({
          name: item.name,
          path: item.path,
          type: item.type as 'file' | 'dir',
          size: item.size,
        }));

        // Sort directories first, then files
        result.sort((a, b) => {
          if (a.type === 'dir' && b.type === 'file') return -1;
          if (a.type === 'file' && b.type === 'dir') return 1;
          return a.name.localeCompare(b.name);
        });
      } else if (data.type === 'file') {
        // It's a single file
        result = [
          {
            name: data.name,
            path: data.path,
            type: 'file',
            size: data.size,
          },
        ];
      }

      // Cache the result
      this.searchCache.set(cacheKey, {
        results: result,
        timestamp: Date.now(),
      });

      return result;
    } catch (error: any) {
      console.error(
        `Error getting directory structure for ${directoryPath} in ${repository}:`,
        error
      );

      if (error.status === 404) {
        return [
          {
            name: `Path not found: ${directoryPath}`,
            path: directoryPath,
            type: 'file',
          },
        ];
      }

      return [
        {
          name: 'Error retrieving directory structure',
          path: directoryPath,
          type: 'file',
        },
      ];
    }
  }

  // Helper function to check if a repository is embedded
  private async isRepositoryEmbedded(repository: string): Promise<boolean> {
    try {
      // First check if chunks exist for this repository, regardless of status
      const chunkKey = `embedding:repo:${repository}:chunks`;
      const chunkCount = await this.redis.llen(chunkKey);

      if (chunkCount > 0) {
        console.log(
          `Repository ${repository} has ${chunkCount} embedded chunks available`
        );
        return true;
      }

      // If no chunks found, fall back to checking status
      const repoKey = `embedding:repo:${repository}:status`;
      const repoStatus = await this.redis.get(repoKey);

      if (!repoStatus) {
        console.log(`No embedding status found for repository ${repository}`);
        return false;
      }

      // Try to parse the status object
      try {
        const status = JSON.parse(repoStatus as string);
        // Consider any status with progress as valid, not just 'completed'
        console.log(
          `Repository ${repository} has embedding status: ${
            status.status
          }, progress: ${status.progress || 0}%`
        );
        return true;
      } catch (error) {
        // If we can't parse the status but it exists, we'll still consider it embedded
        console.log(
          `Could not parse embedding status for ${repository}, but status entry exists`
        );
        return true;
      }
    } catch (error) {
      console.error(
        `Error checking embedding status for ${repository}:`,
        error
      );
      // If there's an error checking Redis, be permissive and assume embedded
      return true;
    }
  }

  // Helper function to perform vector search against embeddings
  private async searchWithVectorEmbeddings(
    query: string,
    repository: string,
    options: {
      fileFilter?: string;
      maxResults?: number;
    }
  ): Promise<
    Array<{ path: string; line: number; content: string; context?: string }>
  > {
    try {
      // Generate embedding for the query
      const embedding = await this.getQueryEmbedding(query);

      // Get all chunks from repository
      const chunkKey = `embedding:repo:${repository}:chunks`;
      const allChunks = await this.redis.lrange(chunkKey, 0, -1);

      if (!allChunks || allChunks.length === 0) {
        return [];
      }

      // Calculate similarities and rank results
      const chunks = allChunks
        .map((chunk) => {
          // Handle different types of chunk data from Redis
          if (typeof chunk === 'object' && chunk !== null) {
            // Already an object, use as is
            return chunk;
          } else if (typeof chunk === 'string') {
            // Check for invalid "[object Object]" string
            if (chunk === '[object Object]') {
              console.warn(
                'Found invalid "[object Object]" string representation'
              );
              return null; // Skip this chunk
            }
            // Parse JSON string
            try {
              return JSON.parse(chunk);
            } catch (e) {
              console.warn(`Error parsing chunk: ${e}`);
              return null; // Skip invalid chunks
            }
          } else {
            console.warn(`Unexpected chunk type: ${typeof chunk}`);
            return null;
          }
        })
        .filter((chunk) => chunk !== null); // Filter out null chunks

      const results: Array<{
        path: string;
        content: string;
        score: number;
        metadata: any;
      }> = [];

      const SIMILARITY_THRESHOLD = 0.2;
      console.log(
        `Searching with similarity threshold: ${SIMILARITY_THRESHOLD}`
      );

      for (const chunk of chunks) {
        // Skip chunks without embeddings
        if (!chunk.embedding) {
          console.log(
            `Skipping chunk without embedding: ${chunk.path || 'unknown'}`
          );
          continue;
        }

        // Apply file filter if specified
        if (options.fileFilter && !chunk.path.includes(options.fileFilter)) {
          continue;
        }

        // Calculate similarity score
        const score = this.cosineSimilarity(embedding, chunk.embedding);

        // Add to results if score is above threshold
        if (score > SIMILARITY_THRESHOLD) {
          results.push({
            path: chunk.path,
            content: chunk.content,
            score,
            metadata: chunk.metadata,
          });
        }
      }

      // Sort by similarity score (highest first)
      results.sort((a, b) => b.score - a.score);

      // Log search stats
      console.log(
        `Found ${results.length} chunks above threshold ${SIMILARITY_THRESHOLD} for "${query}"`
      );
      if (results.length > 0) {
        console.log(
          `Top scores: ${results
            .slice(0, 3)
            .map((r) => r.score.toFixed(2))
            .join(', ')}`
        );
      }

      // Limit results
      const topResults = results.slice(0, options.maxResults || 10);

      // Format results to match the expected output format
      return topResults.map((result) => ({
        path: result.path,
        line: result.metadata.startLine,
        content: result.content,
        context: `Language: ${result.metadata.language}, Type: ${
          result.metadata.type
        }${
          result.metadata.name ? ', Name: ' + result.metadata.name : ''
        }, Lines: ${result.metadata.startLine}-${
          result.metadata.endLine
        }, Score: ${(result.score * 100).toFixed(2)}%`,
      }));
    } catch (error) {
      console.error('Error searching with vector embeddings:', error);
      return [];
    }
  }

  // Helper to generate embeddings for a query
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
          dimensions: 256, // Must match dimension used for code embeddings
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

  // Helper to calculate cosine similarity
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    // Handle edge case of zero vectors
    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
