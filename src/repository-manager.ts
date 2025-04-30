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
   * Perform search with progressive fallback strategies instead of separate functions
   */
  private async performUnifiedSearch(
    originalQuery: string,
    queryTerms: string[],
    repository: string,
    options: {
      contextAware: boolean;
      semanticBoost: boolean;
      fileFilter: string;
      maxResults: number;
    }
  ): Promise<
    Array<{ path: string; line: number; content: string; context?: string }>
  > {
    const [owner, repo] = repository.split('/');
    const octokit = await this.getOctokitForRepo(repository);

    // Prepare path and extension filters
    let pathFilters = options.fileFilter ? ` ${options.fileFilter}` : '';
    pathFilters += this.getRepositorySpecificFilters(repository, originalQuery);

    console.log(
      `Starting unified search for "${originalQuery}" in ${repository}`
    );

    // Track processed files to avoid duplicates across search attempts
    const processedFiles = new Set<string>();
    const results: Array<{
      path: string;
      line: number;
      content: string;
      context?: string;
      score: number;
    }> = [];

    const timeoutDuration = 15000; // 15 seconds timeout

    // Progressive search strategies
    const searchStrategies = [
      {
        name: 'specific',
        queryBuilder: () => {
          // Build specific search with quoted code patterns
          let query = `repo:${repository}${pathFilters}`;

          // Sort by length to prioritize more specific terms
          const sortedPatterns = [
            ...queryTerms.filter((term) =>
              /^[a-zA-Z][a-zA-Z0-9]*(?:[_][a-zA-Z0-9]+)+$|^[a-z][a-zA-Z0-9]*[A-Z]/.test(
                term
              )
            ),
          ].sort((a, b) => b.length - a.length);

          // Quote only the top 2 most specific patterns
          const patternsToQuote = sortedPatterns.slice(
            0,
            Math.min(2, sortedPatterns.length)
          );
          const patternsToAddUnquoted = sortedPatterns.slice(
            Math.min(2, sortedPatterns.length)
          );

          // Add quoted patterns
          for (const pattern of patternsToQuote) {
            query += ` "${pattern}"`;
          }

          // Add unquoted patterns
          if (patternsToAddUnquoted.length > 0) {
            query += ` ${patternsToAddUnquoted.join(' ')}`;
          }

          // Add remaining terms
          const remainingTerms = queryTerms.filter(
            (term) => !sortedPatterns.includes(term)
          );
          if (remainingTerms.length > 0) {
            query += ` ${remainingTerms.join(' ')}`;
          }

          return query;
        },
      },
      {
        name: 'relaxed',
        queryBuilder: () => {
          // Build a more relaxed query without quotes
          let query = `repo:${repository}${pathFilters}`;

          // Add all terms unquoted
          if (queryTerms.length > 0) {
            query += ` ${queryTerms.join(' ')}`;
          }

          return query;
        },
      },
      {
        name: 'simplified',
        queryBuilder: () => {
          // Use only top 3 most important terms
          const priorityTerms = queryTerms.slice(0, 3);

          let query = `repo:${repository}${pathFilters}`;

          if (priorityTerms.length > 0) {
            query += ` ${priorityTerms.join(' ')}`;
          }

          return query;
        },
      },
      {
        name: 'basic',
        queryBuilder: () => {
          // Most basic query possible - just the original query with no processing
          return `repo:${repository}${pathFilters} ${originalQuery}`;
        },
      },
    ];

    // Try each search strategy until we get results
    for (const strategy of searchStrategies) {
      try {
        const searchQuery = strategy.queryBuilder();
        console.log(`Trying ${strategy.name} search: ${searchQuery}`);

        // Set a timeout for the search request
        const searchPromise = octokit.search.code({
          q: searchQuery,
          per_page: options.maxResults * 2,
        });

        // Add a timeout to prevent hanging
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error(`Search timed out (${strategy.name})`)),
            timeoutDuration
          );
        });

        // Race between search and timeout
        const response = (await Promise.race([
          searchPromise,
          timeoutPromise,
        ])) as any;
        const data = response.data;

        // Check if we have valid results
        if (!data?.items?.length) {
          console.log(
            `${strategy.name} search returned no results, trying next strategy`
          );
          continue; // Try next strategy
        }

        // Process each file found by this strategy
        const filesToProcess = data.items.slice(0, options.maxResults * 2);
        let foundResults = false;

        for (const item of filesToProcess) {
          // Skip if we've already processed this file
          if (processedFiles.has(item.path)) continue;
          processedFiles.add(item.path);

          try {
            // Get file content with timeout
            const content = await this.getFileContentWithTimeout(
              item.path,
              repository,
              5000
            );

            // Get context information if needed
            let fileContext = '';
            if (options.contextAware) {
              fileContext =
                strategy.name === 'basic'
                  ? await this.getSimpleFileContext(item.path, content)
                  : await this.getFileContext(item.path, content, repository);
            }

            // Find best matching lines
            const matchResult = this.findBestMatches(
              content,
              queryTerms,
              originalQuery
            );

            if (matchResult.matches.length > 0) {
              // Add each match as a separate result
              for (const match of matchResult.matches.slice(0, 3)) {
                results.push({
                  path: item.path,
                  line: match.line,
                  content: match.content,
                  context: fileContext,
                  score:
                    match.score +
                    (strategy.name === 'specific'
                      ? 50
                      : strategy.name === 'relaxed'
                      ? 30
                      : strategy.name === 'simplified'
                      ? 10
                      : 0),
                });
                foundResults = true;
              }
            } else {
              // No exact match found, use first line or best guess
              const lines = content.split('\n');
              const matchingLineIndex = this.findMatchingLine(
                lines,
                originalQuery
              );

              if (matchingLineIndex !== -1) {
                results.push({
                  path: item.path,
                  line: matchingLineIndex + 1,
                  content: lines[matchingLineIndex].trim(),
                  context: fileContext,
                  score:
                    strategy.name === 'specific'
                      ? 25
                      : strategy.name === 'relaxed'
                      ? 15
                      : strategy.name === 'simplified'
                      ? 5
                      : 0,
                });
                foundResults = true;
              } else {
                // Use first line as fallback
                results.push({
                  path: item.path,
                  line: 1,
                  content: lines[0]?.trim() || 'File matched search criteria',
                  context: fileContext,
                  score:
                    strategy.name === 'specific'
                      ? 10
                      : strategy.name === 'relaxed'
                      ? 5
                      : strategy.name === 'simplified'
                      ? 2
                      : 0,
                });
                foundResults = true;
              }
            }
          } catch (fileError) {
            console.log(
              `Error loading file content for ${item.path}:`,
              fileError
            );
            // If we can't get content, still include the file
            results.push({
              path: item.path,
              line: 1,
              content: 'File matched search criteria',
              score:
                strategy.name === 'specific'
                  ? 5
                  : strategy.name === 'relaxed'
                  ? 2
                  : strategy.name === 'simplified'
                  ? 1
                  : 0,
            });
            foundResults = true;
          }

          // Break early if we found enough results
          if (foundResults && results.length >= options.maxResults * 2) {
            break;
          }
        }

        // If we found results with this strategy, we can stop
        if (foundResults) {
          console.log(
            `Found ${results.length} results using ${strategy.name} search strategy`
          );
          break;
        }
      } catch (error: any) {
        // Log error and continue to next strategy
        console.error(`Error in ${strategy.name} search:`, error.message);
      }
    }

    // If we have no results after trying all strategies
    if (results.length === 0) {
      console.log('All search strategies failed to find results');
      return [
        {
          path: 'search-error.txt',
          line: 1,
          content: `Couldn't find any relevant code for "${originalQuery}". Try with more specific terms or a different query.`,
        },
      ];
    }

    // Sort results by score and return top results
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, options.maxResults).map((r) => ({
      path: r.path,
      line: r.line,
      content: r.content,
      context: r.context,
    }));
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
      // Verify repository access
      await this.verifyRepoAccess(repository);

      // Apply defaults for options
      const searchOptions = {
        contextAware: options.contextAware ?? true,
        semanticBoost: options.semanticBoost ?? true,
        fileFilter: options.fileFilter || '',
        maxResults: options.maxResults || 5,
      };

      // Pre-process query to extract key terms
      const queryTerms = this.extractSearchTerms(query);

      // Check cache first - only if not using semantic boost
      if (!searchOptions.semanticBoost) {
        const cacheKey = `${repository}:${query}:${searchOptions.fileFilter}`;
        const cached = this.searchCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL.SEARCH) {
          console.log(
            `Using cached search results for "${query}" in ${repository}`
          );
          return cached.results;
        }
      }

      console.log(`Searching for "${query}" in ${repository}`);

      // Use unified search instead of separate enhanced and fallback methods
      const results = await this.performUnifiedSearch(
        query,
        queryTerms,
        repository,
        searchOptions
      );

      // Cache results if not semantic boost (semantic results shouldn't be cached)
      if (!searchOptions.semanticBoost) {
        const cacheKey = `${repository}:${query}:${searchOptions.fileFilter}`;
        this.searchCache.set(cacheKey, {
          results: results,
          timestamp: Date.now(),
        });
      }

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
   * Extract meaningful search terms from a query
   */
  private extractSearchTerms(query: string): string[] {
    // Remove common words and noise
    const stopWords = [
      'the',
      'a',
      'an',
      'in',
      'on',
      'at',
      'for',
      'to',
      'with',
      'and',
      'or',
      'of',
    ];

    // Extract camelCase and snake_case terms
    const codePatterns =
      query.match(
        /[a-zA-Z][a-zA-Z0-9]*(?:[_][a-zA-Z0-9]+)+|[a-z][a-zA-Z0-9]*/g
      ) || [];

    // Split remaining text into words - changed minimum length from 3 to 2 to capture more terms
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.includes(word));

    // Combine and deduplicate
    return [...new Set([...codePatterns, ...words])];
  }

  /**
   * Find best matches in file with context and scoring
   */
  private findBestMatches(
    content: string,
    queryTerms: string[],
    originalQuery: string
  ): {
    matches: Array<{
      line: number;
      content: string;
      context?: string;
      score: number;
    }>;
  } {
    const lines = content.split('\n');
    const matches: Array<{
      line: number;
      content: string;
      context?: string;
      score: number;
    }> = [];

    // Look for functions, classes, and methods that might match
    const functionMatches = this.identifyCodeBlocks(lines, queryTerms);

    // Add function matches with higher scores
    for (const match of functionMatches) {
      matches.push({
        line: match.startLine + 1,
        content: lines[match.startLine].trim(),
        context: match.blockType + ': ' + match.name,
        score: 100 + match.score,
      });
    }

    // Also check for direct line matches
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      let score = 0;

      // Score exact matches of original query highest
      if (line.includes(originalQuery.toLowerCase())) {
        score += 50;
      }

      // Score each term match
      for (const term of queryTerms) {
        if (line.includes(term.toLowerCase())) {
          // Award more points for code identifier matches
          if (
            line.includes(`"${term}"`) ||
            line.includes(`'${term}'`) ||
            line.includes(` ${term}(`) ||
            line.includes(`.${term}`)
          ) {
            score += 10;
          } else {
            score += 5;
          }
        }
      }

      // Get surrounding context if good score
      if (score >= 10) {
        let contextLines = '';

        // Add lines before for context
        const startContextLine = Math.max(0, i - 2);
        const endContextLine = Math.min(lines.length - 1, i + 2);

        for (let j = startContextLine; j <= endContextLine; j++) {
          if (j === i) {
            continue; // Skip the matched line itself
          }
          contextLines += lines[j].trim() + '\n';
        }

        matches.push({
          line: i + 1,
          content: lines[i].trim(),
          context: contextLines,
          score: score,
        });
      }
    }

    // Sort by score, highest first
    matches.sort((a, b) => b.score - a.score);

    return { matches };
  }

  /**
   * Identify code blocks (functions, classes, methods) in the file
   */
  private identifyCodeBlocks(
    lines: string[],
    queryTerms: string[]
  ): Array<{
    name: string;
    blockType: string;
    startLine: number;
    endLine: number;
    score: number;
  }> {
    const blocks: Array<{
      name: string;
      blockType: string;
      startLine: number;
      endLine: number;
      score: number;
    }> = [];

    // Simple regex patterns for common code constructs
    const patterns = [
      // Function declarations - various languages
      { regex: /\b(?:function|def|func)\s+(\w+)\s*\(/, type: 'function' },
      // Class declarations
      { regex: /\b(?:class)\s+(\w+)/, type: 'class' },
      // Method declarations
      {
        regex:
          /\b(?:public|private|protected)?\s*(?:static)?\s*(?:async)?\s+\w+\s+(\w+)\s*\(/,
        type: 'method',
      },
      // JS/TS arrow functions with name
      {
        regex: /\bconst\s+(\w+)\s*=\s*(?:async)?\s*\(.*\)\s*=>/,
        type: 'function',
      },
      // Swift/Kotlin function
      { regex: /\bfunc\s+(\w+)\s*\(/, type: 'function' },
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check each pattern
      for (const pattern of patterns) {
        const match = line.match(pattern.regex);
        if (match && match[1]) {
          const name = match[1];

          // Estimate the end of the block (simple approach)
          let blockEnd = i;
          let openBraces = line.split('{').length - line.split('}').length;

          // Only proceed if this might be a block start
          if (openBraces > 0 || line.includes(':')) {
            // Find matching end, scanning ahead
            for (let j = i + 1; j < Math.min(lines.length, i + 100); j++) {
              const braceBalance =
                lines[j].split('{').length - lines[j].split('}').length;
              openBraces += braceBalance;

              if (openBraces <= 0) {
                blockEnd = j;
                break;
              }
            }

            // Calculate score based on query term matches
            let score = 0;

            // Match function/class name directly
            for (const term of queryTerms) {
              // Direct match on name is a strong signal
              if (name.toLowerCase().includes(term.toLowerCase())) {
                score += 30;
              }

              // Also check content of the block for matches
              if (blockEnd > i) {
                for (let j = i; j <= blockEnd; j++) {
                  if (lines[j].toLowerCase().includes(term.toLowerCase())) {
                    score += 5;
                  }
                }
              }
            }

            // Only add if this block is relevant
            if (score > 0) {
              blocks.push({
                name,
                blockType: pattern.type,
                startLine: i,
                endLine: blockEnd,
                score,
              });
            }
          }
        }
      }
    }

    return blocks;
  }

  /**
   * Get repository-specific search optimizations
   */
  private getRepositorySpecificFilters(
    repository: string,
    query: string
  ): string {
    // Handle special cases for known repositories
    if (repository.includes('service-supply')) {
      // Focus on Python files for service-supply
      let filters = ' extension:py';

      // Add path filters for common query topics
      if (
        query.toLowerCase().includes('ship') ||
        query.toLowerCase().includes('track') ||
        query.toLowerCase().includes('order')
      ) {
        filters +=
          ' path:supply/logistics path:supply/order_management path:supply/apis';
      }
      return filters;
    }

    if (repository.includes('service-frontend')) {
      // For frontend repo, focus on TypeScript and relevant component files
      let filters = ' extension:ts extension:tsx';

      if (
        query.toLowerCase().includes('component') ||
        query.toLowerCase().includes('ui') ||
        query.toLowerCase().includes('interface')
      ) {
        filters += ' path:src/components path:src/ui path:src/views';
      }

      return filters;
    }

    return '';
  }

  /**
   * Get context information about a file for better search results
   */
  private async getFileContext(
    path: string,
    content: string,
    repository: string
  ): Promise<string> {
    try {
      // Check cache first
      const cacheKey = `ctx:${repository}:${path}`;
      const cached = this.contextCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL.CONTEXT) {
        return this.formatFileContext(cached);
      }

      // Determine file type from extension
      const extension = path.substring(path.lastIndexOf('.'));
      const fileType = this.CODE_EXTENSIONS[extension] || 'unknown';

      // Extract imports, functions, and classes based on file type
      const imports: string[] = [];
      const functions: string[] = [];
      const classes: string[] = [];

      const lines = content.split('\n');

      if (
        fileType === 'javascript' ||
        fileType === 'typescript' ||
        fileType === 'jsx' ||
        fileType === 'tsx'
      ) {
        // Extract JS/TS imports
        for (const line of lines) {
          const importMatch = line.match(
            /import\s+(?:{[^}]+}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/
          );
          if (importMatch) {
            imports.push(importMatch[1]);
          }

          // Extract function names (simplified)
          const funcMatch = line.match(/\bfunction\s+(\w+)|const\s+(\w+)\s*=/);
          if (funcMatch) {
            functions.push(funcMatch[1] || funcMatch[2]);
          }

          // Extract class names
          const classMatch = line.match(/\bclass\s+(\w+)/);
          if (classMatch) {
            classes.push(classMatch[1]);
          }
        }
      } else if (fileType === 'python') {
        // Extract Python imports
        for (const line of lines) {
          const importMatch = line.match(
            /from\s+(\S+)\s+import|import\s+(\S+)/
          );
          if (importMatch) {
            imports.push(importMatch[1] || importMatch[2]);
          }

          // Extract function definitions
          const funcMatch = line.match(/def\s+(\w+)\s*\(/);
          if (funcMatch) {
            functions.push(funcMatch[1]);
          }

          // Extract class definitions
          const classMatch = line.match(/class\s+(\w+)\s*\(?/);
          if (classMatch) {
            classes.push(classMatch[1]);
          }
        }
      }

      // Store in cache
      const contextData = {
        fileType,
        imports,
        functions,
        classes,
        timestamp: Date.now(),
      };

      this.contextCache.set(cacheKey, contextData);

      return this.formatFileContext(contextData);
    } catch (error) {
      console.error(`Error getting file context for ${path}:`, error);
      return '';
    }
  }

  /**
   * Format file context data into a string for the search results
   */
  private formatFileContext(contextData: {
    fileType: string;
    imports: string[];
    functions: string[];
    classes: string[];
  }): string {
    let result = `[${contextData.fileType}] `;

    if (contextData.classes.length > 0) {
      result += `Classes: ${contextData.classes.slice(0, 3).join(', ')}${
        contextData.classes.length > 3 ? '...' : ''
      } `;
    }

    if (contextData.functions.length > 0) {
      result += `Functions: ${contextData.functions.slice(0, 5).join(', ')}${
        contextData.functions.length > 5 ? '...' : ''
      } `;
    }

    if (contextData.imports.length > 0) {
      result += `Imports: ${contextData.imports.slice(0, 3).join(', ')}${
        contextData.imports.length > 3 ? '...' : ''
      } `;
    }

    return result;
  }

  /**
   * Get simplified file context for fallback search
   */
  private async getSimpleFileContext(
    path: string,
    content: string
  ): Promise<string> {
    const extension = path.substring(path.lastIndexOf('.'));
    const fileType = this.CODE_EXTENSIONS[extension] || 'unknown';

    // Just get the first few lines that aren't blank/comment-only
    const lines = content.split('\n');
    const contextLines: string[] = [];

    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const line = lines[i].trim();
      if (
        line &&
        !line.startsWith('//') &&
        !line.startsWith('#') &&
        !line.startsWith('/*')
      ) {
        contextLines.push(line);
        if (contextLines.length >= 3) break;
      }
    }

    return `[${fileType}] ${contextLines.join(' | ')}`;
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
}
