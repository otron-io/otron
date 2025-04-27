import { Octokit } from '@octokit/rest';
import { env } from './env.js';
import { GitHubAppService } from './github-app.js';

/**
 * A simplified repository manager that uses only GitHub API operations.
 * This class provides code search, file content retrieval, and PR creation
 * capabilities while ensuring fast operations suitable for serverless environments.
 */
export class LocalRepositoryManager {
  private octokit: Octokit;
  private githubAppService: GitHubAppService | null = null;
  private allowedRepositories: string[];

  // Simple cache objects
  private fileCache: Map<string, { content: string; timestamp: number }> =
    new Map();
  private searchCache: Map<string, { results: any[]; timestamp: number }> =
    new Map();

  // Cache TTL values in milliseconds
  private readonly CACHE_TTL = {
    FILE: 5 * 60 * 1000, // 5 minutes
    SEARCH: 2 * 60 * 1000, // 2 minutes
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
    repository: string
  ): Promise<Array<{ path: string; line: number; content: string }>> {
    try {
      // Verify repository access
      await this.verifyRepoAccess(repository);

      // Check cache first
      const cacheKey = `${repository}:${query}`;
      const cached = this.searchCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL.SEARCH) {
        console.log(
          `Using cached search results for "${query}" in ${repository}`
        );
        return cached.results;
      }

      console.log(`Searching for "${query}" in ${repository}`);

      // Perform direct search with no fallbacks
      const results = await this.performSearch(query, repository);

      // Cache results
      this.searchCache.set(cacheKey, {
        results: results,
        timestamp: Date.now(),
      });

      return results;
    } catch (error) {
      console.error(`Error searching for "${query}" in ${repository}:`, error);
      // Return empty results with a message
      return [
        {
          path: 'search-error.txt',
          line: 1,
          content: `Search could not be completed. Try with more specific terms.`,
        },
      ];
    }
  }

  /**
   * Perform the actual search with GitHub API - limited to top 5 files maximum
   */
  private async performSearch(
    query: string,
    repository: string
  ): Promise<Array<{ path: string; line: number; content: string }>> {
    const [owner, repo] = repository.split('/');
    const octokit = await this.getOctokitForRepo(repository);

    // Handle special cases for known repositories
    const isServiceSupply = repository.includes('service-supply');

    // For service-supply repo, we know it has a specific structure
    let pathFilters = '';
    if (isServiceSupply) {
      // Focus on Python files for service-supply
      pathFilters = ' extension:py';

      // Add path filters for common query topics
      if (
        query.toLowerCase().includes('ship') ||
        query.toLowerCase().includes('track') ||
        query.toLowerCase().includes('order')
      ) {
        pathFilters +=
          ' path:supply/logistics path:supply/order_management path:supply/apis';
      }
    }

    try {
      // Build the search query
      const searchQuery = `repo:${repository}${pathFilters} ${query}`;
      console.log(`Executing search: ${searchQuery}`);

      // Set a timeout for the search request
      const searchPromise = octokit.search.code({
        q: searchQuery,
        per_page: 5, // Strict limit of 5 files
      });

      // Add a timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Search timed out')), 8000);
      });

      // Race between search and timeout
      const { data } = (await Promise.race([
        searchPromise,
        timeoutPromise,
      ])) as any;

      if (!data?.items?.length) {
        // If no results, return empty array
        return [];
      }

      // Process results (max 5 files)
      const results: Array<{ path: string; line: number; content: string }> =
        [];
      const filesToProcess = data.items.slice(0, 5); // Double-checking we only get 5 max

      // Process each file
      for (const item of filesToProcess) {
        try {
          // Get file content with timeout
          const content = await this.getFileContentWithTimeout(
            item.path,
            repository,
            2000
          );

          // Find relevant line
          const lines = content.split('\n');
          const matchingLineIndex = this.findMatchingLine(lines, query);

          if (matchingLineIndex !== -1) {
            results.push({
              path: item.path,
              line: matchingLineIndex + 1,
              content: lines[matchingLineIndex].trim(),
            });
          } else {
            // No exact match found, return first line
            results.push({
              path: item.path,
              line: 1,
              content: lines[0]?.trim() || 'File matched by name',
            });
          }
        } catch (error) {
          // If we can't get content, still include the file
          results.push({
            path: item.path,
            line: 1,
            content: 'File matched search criteria',
          });
        }
      }

      return results;
    } catch (error) {
      console.error('Search error:', error);
      return []; // Return empty array on error
    }
  }

  /**
   * Find a line in the file that matches the search query
   */
  private findMatchingLine(lines: string[], query: string): number {
    const queryTerms = query.toLowerCase().split(/\s+/);

    // First try to find lines containing all terms
    for (let i = 0; i < Math.min(lines.length, 100); i++) {
      const line = lines[i].toLowerCase();
      if (queryTerms.every((term) => line.includes(term))) {
        return i;
      }
    }

    // Then try to find lines with any important term
    for (let i = 0; i < Math.min(lines.length, 100); i++) {
      const line = lines[i].toLowerCase();
      const hasImportantTerm = queryTerms
        .filter((term) => term.length > 3)
        .some((term) => line.includes(term));

      if (hasImportantTerm) {
        return i;
      }
    }

    return -1; // No match found
  }

  /**
   * Get the content of a file with a timeout
   */
  private async getFileContentWithTimeout(
    path: string,
    repository: string,
    timeoutMs: number
  ): Promise<string> {
    try {
      // Create a promise that will timeout
      const timeoutPromise = new Promise<string>((_, reject) => {
        setTimeout(
          () => reject(new Error('File content retrieval timed out')),
          timeoutMs
        );
      });

      // Get the content (with timeout race)
      return await Promise.race([
        this.getFileContent(path, repository),
        timeoutPromise,
      ]);
    } catch (error) {
      console.error(`Error getting file content for ${path}:`, error);
      return `# Error retrieving file content for ${path}`;
    }
  }

  /**
   * Get the content of a file from GitHub
   */
  async getFileContent(path: string, repository: string): Promise<string> {
    try {
      // Check if allowed repository
      await this.verifyRepoAccess(repository);

      // Check cache
      const cacheKey = `${repository}:${path}`;
      const cached = this.fileCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL.FILE) {
        console.log(`Using cached content for ${path} in ${repository}`);
        return cached.content;
      }

      // Fetch file content
      console.log(`Fetching content of ${path} from ${repository}`);
      const [owner, repo] = repository.split('/');
      const octokit = await this.getOctokitForRepo(repository);

      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path,
      });

      if (!('content' in data) || typeof data.content !== 'string') {
        throw new Error(`Unexpected response format for ${path}`);
      }

      // Decode base64 content
      const content = Buffer.from(data.content, 'base64').toString('utf-8');

      // Cache the content
      this.fileCache.set(cacheKey, {
        content,
        timestamp: Date.now(),
      });

      return content;
    } catch (error: any) {
      console.error(
        `Error getting file content for ${path} from ${repository}:`,
        error
      );

      if (error.status === 404) {
        return `# File not found: ${path}`;
      }

      return `# Error retrieving content for ${path}`;
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
      const cacheKey = `${repository}:${path}`;
      this.fileCache.delete(cacheKey);
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
}
