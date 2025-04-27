import { Octokit } from '@octokit/rest';
import '@octokit/plugin-rest-endpoint-methods';
import '@octokit/plugin-paginate-rest';
import { Issue } from '@linear/sdk';
import OpenAI from 'openai';
import { env } from './env.js';
import { PRManager } from './pr-manager.js';
import { LocalRepositoryManager } from './repository-manager.js';
import * as path from 'path';
import * as fs from 'fs/promises';

// Define CodeFile interface
interface CodeFile {
  path: string;
  repository: string;
  content: string;
  url?: string; // Make url optional to match existing usage
}

// Add the necessary interfaces
interface CodebaseAnalysis {
  repository: string;
  fileStats: { totalFiles: number; filesByExtension: Record<string, number> };
  languages: Record<string, number>;
  contributors: { name: string; commits: number }[];
  commitFrequency: { week: string; commits: number }[];
  recentCommits: {
    sha: string;
    message: string;
    author: string;
    date: string;
  }[];
}

interface CodeSearchResult {
  repository: string;
  path: string;
  url: string;
  score: number;
}

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

/**
 * Advanced code analysis utilities to improve bug detection and technical analysis
 */
export class CodeAnalyzer {
  constructor(
    private getOctokit: (repository: string) => Promise<Octokit>,
    private prManager: PRManager,
    private localRepoManager: LocalRepositoryManager,
    private allowedRepositories: string[]
  ) {}

  /**
   * Trace dependencies between files to build a more complete understanding of related code
   */
  async traceCodeDependencies(
    startingFiles: Array<{ path: string; content: string; repository: string }>,
    depth: number = 2
  ): Promise<Array<{ path: string; content: string; repository: string }>> {
    const visitedFiles = new Map<
      string,
      { path: string; content: string; repository: string }
    >();
    const pendingFiles: Array<{
      path: string;
      content: string;
      repository: string;
    }> = [...startingFiles];

    // Add initial files to visited map
    for (const file of startingFiles) {
      const key = `${file.repository}:${file.path}`;
      visitedFiles.set(key, file);
    }

    // Process dependencies up to the specified depth
    for (let currentDepth = 0; currentDepth < depth; currentDepth++) {
      const newPendingFiles: Array<{
        path: string;
        content: string;
        repository: string;
      }> = [];

      // Process each file in the current level
      for (const file of pendingFiles) {
        // Extract imports and dependencies from the file
        const dependencies = await this.extractFileDependencies(file);

        // Add each new dependency to the processing queue
        for (const dep of dependencies) {
          const key = `${dep.repository}:${dep.path}`;
          if (!visitedFiles.has(key)) {
            visitedFiles.set(key, dep);
            newPendingFiles.push(dep);
          }
        }
      }

      // If no new files were added, we can stop early
      if (newPendingFiles.length === 0) {
        break;
      }

      // Set up for next iteration
      pendingFiles.length = 0;
      pendingFiles.push(...newPendingFiles);
    }

    return Array.from(visitedFiles.values());
  }

  /**
   * Extract dependencies (imports, requires) from a file
   */
  private async extractFileDependencies(file: {
    path: string;
    content: string;
    repository: string;
  }): Promise<Array<{ path: string; content: string; repository: string }>> {
    const dependencies: Array<{
      path: string;
      content: string;
      repository: string;
    }> = [];
    const { path: filePath, content, repository } = file;

    // Skip non-code files
    const ext = this.getFileExtension(filePath);
    if (!ext || !this.isCodeFile(ext)) {
      return dependencies;
    }

    // Extract different types of imports based on file type
    const importPaths = this.extractImportPaths(content, ext);

    // Resolve each import to an actual file
    for (const importPath of importPaths) {
      try {
        // Resolve the import to an actual file path
        const resolvedPath = this.resolveImportPath(
          filePath,
          importPath,
          repository
        );
        if (!resolvedPath) continue;

        // Fetch the content of the dependency using localRepoManager
        const depContent = await this.localRepoManager.getFileContent(
          resolvedPath,
          repository
        );

        dependencies.push({
          path: resolvedPath,
          content: depContent,
          repository,
        });
      } catch (error) {
        console.error(
          `Error resolving dependency ${importPath} from ${filePath}:`,
          error
        );
      }
    }

    return dependencies;
  }

  /**
   * Extract import statements from file content
   */
  private extractImportPaths(content: string, fileExtension: string): string[] {
    const importPaths: string[] = [];

    // Different regex patterns for different file types
    if (['js', 'jsx', 'ts', 'tsx'].includes(fileExtension)) {
      // ES6 imports
      const es6ImportRegex =
        /import\s+(?:[\w\s{},*]*\s+from\s+)?['"]([^'"]+)['"]/g;
      let match;
      while ((match = es6ImportRegex.exec(content)) !== null) {
        importPaths.push(match[1]);
      }

      // CommonJS requires
      const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((match = requireRegex.exec(content)) !== null) {
        importPaths.push(match[1]);
      }
    } else if (['py'].includes(fileExtension)) {
      // Python imports
      const pythonImportRegex =
        /(?:from\s+([^\s]+)\s+import|import\s+([^\s,]+))/g;
      let match;
      while ((match = pythonImportRegex.exec(content)) !== null) {
        const importPath = match[1] || match[2];
        if (importPath) importPaths.push(importPath.replace(/\./g, '/'));
      }
    } else if (['rb'].includes(fileExtension)) {
      // Ruby requires
      const rubyRequireRegex = /require\s+['"]([^'"]+)['"]/g;
      let match;
      while ((match = rubyRequireRegex.exec(content)) !== null) {
        importPaths.push(match[1]);
      }
    }

    return importPaths;
  }

  /**
   * Resolve a relative import path to an absolute path
   */
  private resolveImportPath(
    filePath: string,
    importPath: string,
    repository: string
  ): string | null {
    // Skip built-in modules and node_modules
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return null;
    }

    const fileDir = path.dirname(filePath);
    let resolvedPath;

    // Handle relative imports
    if (importPath.startsWith('.')) {
      resolvedPath = path.join(fileDir, importPath);
    } else if (importPath.startsWith('/')) {
      // Absolute path (relative to repository root)
      resolvedPath = importPath.slice(1); // Remove leading slash
    } else {
      return null; // Skip external dependencies
    }

    // Handle extensions
    if (!path.extname(resolvedPath)) {
      // Try common extensions based on the importing file's extension
      const ext = path.extname(filePath);
      const potentialExtensions = [
        ext,
        '.js',
        '.jsx',
        '.ts',
        '.tsx',
        '.py',
        '.rb',
      ];

      for (const potentialExt of potentialExtensions) {
        const withExt = resolvedPath + potentialExt;
        // Here we could check if the file exists, but for simplicity, we'll just return the first option
        return withExt;
      }
    }

    return resolvedPath;
  }

  /**
   * Build a function call graph to understand relationships between functions
   */
  async buildFunctionCallGraph(
    files: Array<{ path: string; content: string; repository: string }>
  ): Promise<{
    callGraph: Map<string, string[]>;
    functionDetails: Map<string, string>;
  }> {
    const callGraph = new Map<string, string[]>();
    const functionDetails = new Map<string, string>();

    for (const file of files) {
      const { path: filePath, content, repository } = file;
      const ext = this.getFileExtension(filePath);

      // Skip non-code files
      if (!ext || !this.isCodeFile(ext)) {
        continue;
      }

      // Extract function definitions
      const functions = this.extractFunctionDefinitions(content, ext);

      // For each function, identify calls to other functions
      for (const func of functions) {
        const functionKey = `${repository}:${filePath}#${func.name}`;
        const callsTo = this.extractFunctionCalls(content, func.body, ext);

        callGraph.set(functionKey, callsTo);

        // Store the function's code and signature for later reference
        functionDetails.set(functionKey, func.body);
      }
    }

    return { callGraph, functionDetails };
  }

  /**
   * Extract function definitions from a file
   */
  private extractFunctionDefinitions(
    content: string,
    fileExtension: string
  ): Array<{ name: string; body: string }> {
    const functions: Array<{ name: string; body: string }> = [];

    // Different regex patterns for different file types
    if (['js', 'jsx', 'ts', 'tsx'].includes(fileExtension)) {
      // Regular functions and arrow functions
      const funcRegex =
        /(?:function\s+(\w+)\s*\(([^)]*)\)|const\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>)\s*{([^{}]*(?:{[^{}]*(?:{[^{}]*}[^{}]*)*}[^{}]*)*)}/gs;
      let match;

      while ((match = funcRegex.exec(content)) !== null) {
        const name = match[1] || match[3];
        const params = match[2] || match[4];
        const body = match[5] || '';

        if (name) {
          functions.push({
            name,
            body: `function ${name}(${params}) { ${body} }`,
          });
        }
      }

      // Class methods
      const methodRegex =
        /class\s+(\w+)(?:\s+extends\s+\w+)?\s*{([^{}]*(?:{[^{}]*(?:{[^{}]*}[^{}]*)*}[^{}]*)*)}/gs;
      while ((match = methodRegex.exec(content)) !== null) {
        const className = match[1];
        const classBody = match[2];

        // Extract methods from class body
        const methodMatch =
          /(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*{([^{}]*(?:{[^{}]*(?:{[^{}]*}[^{}]*)*}[^{}]*)*)}/gs;
        let methodResult;

        while ((methodResult = methodMatch.exec(classBody)) !== null) {
          const methodName = methodResult[1];
          const params = methodResult[2];
          const body = methodResult[3];

          functions.push({
            name: `${className}.${methodName}`,
            body: `function ${className}.${methodName}(${params}) { ${body} }`,
          });
        }
      }
    } else if (['py'].includes(fileExtension)) {
      // Python functions
      const funcRegex =
        /def\s+(\w+)\s*\(([^)]*)\)(?:\s*->.*?)?\s*:\s*((?:\n\s+[^\n]*)*)/gs;
      let match;

      while ((match = funcRegex.exec(content)) !== null) {
        const name = match[1];
        const params = match[2];
        const body = match[3] || '';

        functions.push({
          name,
          body: `def ${name}(${params}):\n${body}`,
        });
      }

      // Python class methods
      const classRegex = /class\s+(\w+)(?:\(.*?\))?\s*:\s*((?:\n\s+[^\n]*)*)/gs;
      while ((match = classRegex.exec(content)) !== null) {
        const className = match[1];
        const classBody = match[2];

        // Extract methods from class body
        const methodMatch =
          /def\s+(\w+)\s*\(self(?:,\s*([^)]*))?\)(?:\s*->.*?)?\s*:\s*((?:\n\s+[^\n]*)*)/gs;
        let methodResult;

        while ((methodResult = methodMatch.exec(classBody)) !== null) {
          const methodName = methodResult[1];
          const params = methodResult[2] || '';
          const body = methodResult[3] || '';

          functions.push({
            name: `${className}.${methodName}`,
            body: `def ${className}.${methodName}(self, ${params}):\n${body}`,
          });
        }
      }
    }

    return functions;
  }

  /**
   * Extract function calls from a block of code
   */
  private extractFunctionCalls(
    content: string,
    functionBody: string,
    fileExtension: string
  ): string[] {
    const calls: string[] = [];

    // Different regex patterns for different file types
    if (['js', 'jsx', 'ts', 'tsx'].includes(fileExtension)) {
      // Basic function calls
      const callRegex = /\b(\w+)\s*\(/g;
      let match;

      while ((match = callRegex.exec(functionBody)) !== null) {
        const calledFunc = match[1];
        // Skip common JavaScript built-ins and controls
        if (
          !['if', 'for', 'while', 'switch', 'catch', 'console'].includes(
            calledFunc
          )
        ) {
          calls.push(calledFunc);
        }
      }

      // Method calls on objects
      const methodCallRegex = /(\w+)\.(\w+)\s*\(/g;
      while ((match = methodCallRegex.exec(functionBody)) !== null) {
        const obj = match[1];
        const method = match[2];
        // Skip console and other common objects
        if (!['console', 'Math', 'JSON', 'Object', 'Array'].includes(obj)) {
          calls.push(`${obj}.${method}`);
        }
      }
    } else if (['py'].includes(fileExtension)) {
      // Python function calls
      const callRegex = /\b(\w+)\s*\(/g;
      let match;

      while ((match = callRegex.exec(functionBody)) !== null) {
        const calledFunc = match[1];
        // Skip Python built-ins
        if (
          ![
            'print',
            'len',
            'str',
            'int',
            'float',
            'list',
            'dict',
            'set',
          ].includes(calledFunc)
        ) {
          calls.push(calledFunc);
        }
      }

      // Method calls
      const methodCallRegex = /(\w+)\.(\w+)\s*\(/g;
      while ((match = methodCallRegex.exec(functionBody)) !== null) {
        const obj = match[1];
        const method = match[2];
        calls.push(`${obj}.${method}`);
      }
    }

    return [...new Set(calls)]; // Remove duplicates
  }

  /**
   * Parse stack traces to identify relevant files for bug analysis
   */
  async parseStackTrace(stackTrace: string): Promise<
    Array<{
      path: string;
      content: string;
      repository: string;
      lineNumber: number;
    }>
  > {
    const results: Array<{
      path: string;
      content: string;
      repository: string;
      lineNumber: number;
    }> = [];
    const stackFrameRegex =
      /(?:at\s+|File\s+["'])([^:"']+)[:"'](?:line\s+)?(\d+)/g;

    let match;
    while ((match = stackFrameRegex.exec(stackTrace)) !== null) {
      const filePath = match[1].trim();
      const lineNumber = parseInt(match[2], 10);

      // Determine which repository this file belongs to
      for (const repo of this.allowedRepositories) {
        try {
          const content = await this.localRepoManager.getFileContent(
            filePath,
            repo
          );

          results.push({
            path: filePath,
            content,
            repository: repo,
            lineNumber,
          });

          // Found the file, no need to check other repos
          break;
        } catch (error) {
          // File not found in this repo, try the next one
          continue;
        }
      }
    }

    return results;
  }

  /**
   * Build a high-level structure overview of a repository for context
   */
  async getCodebaseStructure(repository: string): Promise<string> {
    try {
      // Ensure the repository is cloned locally
      const repoPath = await this.localRepoManager.ensureRepoCloned(repository);
      let structure = `Repository: ${repository}\nTop-level structure:\n`;

      // Get top-level directories directly from the filesystem
      const entries = await fs.readdir(repoPath, { withFileTypes: true });

      // Filter out hidden files and git directory
      const filteredEntries = entries.filter(
        (entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules'
      );

      // Build a simple tree structure
      for (const entry of filteredEntries) {
        if (entry.isDirectory()) {
          structure += `- 📁 ${entry.name}/\n`;
        } else {
          structure += `- 📄 ${entry.name}\n`;
        }
      }

      return structure;
    } catch (error) {
      console.error(`Error getting structure for ${repository}:`, error);
      return `Could not retrieve structure for ${repository}`;
    }
  }

  /**
   * Get statistics about file types in a repository
   */
  async getFileStatistics(
    repository: string
  ): Promise<{ totalFiles: number; filesByExtension: Record<string, number> }> {
    try {
      const extensions = [
        '.js',
        '.ts',
        '.tsx',
        '.jsx',
        '.py',
        '.java',
        '.rb',
        '.go',
        '.php',
        '.cs',
        '.cpp',
        '.html',
        '.css',
        '.json',
      ];
      const filesByExtension: Record<string, number> = {};
      let totalFiles = 0;

      for (const ext of extensions) {
        try {
          const octokit = await this.getOctokit(repository);
          const response = await octokit.rest.search.code({
            q: `extension:${ext.substring(1)} repo:${repository}`,
            per_page: 100,
          });

          const count = response.data.total_count;
          if (count > 0) {
            filesByExtension[ext] = count;
            totalFiles += count;
          }
        } catch (error) {
          console.error(
            `Error searching for ${ext} files in ${repository}:`,
            error
          );
        }
      }

      return { totalFiles, filesByExtension };
    } catch (error) {
      console.error(`Error getting file statistics for ${repository}:`, error);
      return { totalFiles: 0, filesByExtension: {} };
    }
  }

  /**
   * Perform a progressive analysis that iteratively refines search results
   */
  async progressiveAnalysis(
    issue: Issue,
    initialFiles: Array<{ path: string; content: string; repository: string }>
  ): Promise<{
    relevantFiles: Array<{ path: string; content: string; repository: string }>;
    bugHypothesis: string;
    callGraph: Map<string, string[]>;
    functionDetails: Map<string, string>;
    dataFlowPaths: Map<string, string[]>;
    relatedCommits: Array<{ sha: string; message: string; url: string }>;
  }> {
    // 1. Generate initial bug hypothesis
    const bugHypothesis = await this.generateBugHypothesis(issue, initialFiles);

    // 2. Extract key terms and variables from the hypothesis
    const { keyTerms, dataElements } = await this.extractKeyTermsFromHypothesis(
      bugHypothesis
    );

    // 3. Search for additional files based on key terms
    const additionalFiles = await this.searchFilesBasedOnTerms(keyTerms);

    // 4. Trace dependencies to find connected files
    const dependencyFiles = await this.traceCodeDependencies(
      [...initialFiles, ...additionalFiles],
      1
    );

    // 5. Build a function call graph
    const { callGraph, functionDetails } = await this.buildFunctionCallGraph(
      dependencyFiles
    );

    // 6. Trace data flow for key variables
    const dataFlowPaths = await this.traceDataFlow(
      dependencyFiles,
      dataElements
    );

    // 7. Find similar bug patterns in commit history
    const relatedCommits = await this.findSimilarBugCommits(keyTerms);

    // Combine all results, removing duplicates
    const allFiles = [...initialFiles, ...additionalFiles, ...dependencyFiles];
    const uniqueFilePaths = new Set<string>();
    const relevantFiles: Array<{
      path: string;
      content: string;
      repository: string;
    }> = [];

    for (const file of allFiles) {
      const key = `${file.repository}:${file.path}`;
      if (!uniqueFilePaths.has(key)) {
        uniqueFilePaths.add(key);
        relevantFiles.push(file);
      }
    }

    return {
      relevantFiles,
      bugHypothesis,
      callGraph,
      functionDetails,
      dataFlowPaths,
      relatedCommits,
    };
  }

  /**
   * Generate an initial bug hypothesis based on issue description and files
   */
  private async generateBugHypothesis(
    issue: Issue,
    files: Array<{ path: string; content: string; repository: string }>
  ): Promise<string> {
    // Format files for the prompt
    const filesContext = files
      .map((file) => {
        return `Repository: ${file.repository}\nPath: ${
          file.path
        }\n\`\`\`\n${file.content.slice(0, 1000)}${
          file.content.length > 1000 ? '...(truncated)' : ''
        }\n\`\`\``;
      })
      .join('\n\n');

    // Generate the hypothesis using OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `You are an expert code analyst specializing in bug detection. 
Based on the issue description and code snippets, formulate a specific, technical hypothesis about the root cause of the bug.
Focus on specific functions, variables, or logic flows that might be causing the issue.
Include specific file paths, function names, and variable names in your hypothesis.
Be precise and technical - this will guide further code search.`,
        },
        {
          role: 'user',
          content: `
Issue: ${issue.identifier} - ${issue.title}
Description: ${issue.description || 'No description provided'}

Code files:
${filesContext}

Provide a specific technical hypothesis about this bug, focusing on:
1. Which files/functions are likely involved in the bug
2. What specific variables or data might be incorrect
3. What logic flow or condition might be failing
4. Any potential race conditions, edge cases, or error handling issues
`,
        },
      ],
      temperature: 0.2,
      max_tokens: 800,
    });

    return response.choices[0].message.content || '';
  }

  /**
   * Extract key terms and data elements from the bug hypothesis
   */
  private async extractKeyTermsFromHypothesis(hypothesis: string): Promise<{
    keyTerms: string[];
    dataElements: string[];
  }> {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: `Extract key technical terms and data elements from the bug hypothesis.
Technical terms include function names, component names, file paths, and technical concepts.
Data elements are variable names, object properties, and data structures mentioned.`,
        },
        {
          role: 'user',
          content: `Bug hypothesis: ${hypothesis}

Extract:
1. Technical terms (function names, components, file paths)
2. Data elements (variable names, object properties)

Format as JSON with two arrays: "keyTerms" and "dataElements".`,
        },
      ],
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });

    try {
      const result = JSON.parse(response.choices[0].message.content || '{}');
      return {
        keyTerms: Array.isArray(result.keyTerms) ? result.keyTerms : [],
        dataElements: Array.isArray(result.dataElements)
          ? result.dataElements
          : [],
      };
    } catch (error) {
      console.error('Error parsing key terms extraction:', error);
      return { keyTerms: [], dataElements: [] };
    }
  }

  /**
   * Search for additional files based on key terms
   */
  private async searchFilesBasedOnTerms(
    terms: string[]
  ): Promise<Array<{ path: string; content: string; repository: string }>> {
    const results: Array<{
      path: string;
      content: string;
      repository: string;
    }> = [];
    const processedFiles = new Set<string>();

    // Use the most specific terms first (typically longer terms are more specific)
    const sortedTerms = [...terms].sort((a, b) => b.length - a.length);

    // Limit to top 5 most specific terms to avoid too many API calls
    const searchTerms = sortedTerms.slice(0, 5);

    for (const term of searchTerms) {
      if (!term || term.length < 3) continue; // Skip very short terms

      for (const repository of this.allowedRepositories) {
        try {
          // Use localRepoManager for code search
          const searchResults = await this.localRepoManager.searchCode(
            term,
            repository
          );

          // For each result, get the file content
          for (const item of searchResults) {
            const filePath = item.path;
            const fileKey = `${repository}:${filePath}`;

            // Skip if we already have this file
            if (processedFiles.has(fileKey)) {
              continue;
            }

            try {
              // Get file content using localRepoManager
              const content = await this.localRepoManager.getFileContent(
                filePath,
                repository
              );

              results.push({
                path: filePath,
                content,
                repository,
              });

              processedFiles.add(fileKey);
            } catch (error) {
              console.error(`Error fetching content for ${filePath}:`, error);
            }
          }
        } catch (error) {
          console.error(
            `Error searching for term "${term}" in ${repository}:`,
            error
          );
        }
      }
    }

    return results;
  }

  /**
   * Trace data flow for key variables across files
   */
  private async traceDataFlow(
    files: Array<{ path: string; content: string; repository: string }>,
    dataElements: string[]
  ): Promise<Map<string, string[]>> {
    const dataFlowMap = new Map<string, string[]>();

    // For each data element, find all references in the files
    for (const dataElement of dataElements) {
      const references: string[] = [];

      for (const file of files) {
        const { path: filePath, content, repository } = file;

        // Skip binary or very large files
        if (content.length > 1000000 || /^\0/.test(content)) {
          continue;
        }

        // Look for references to this data element
        const pattern = new RegExp(
          `\\b${this.escapeRegExp(dataElement)}\\b`,
          'g'
        );

        if (pattern.test(content)) {
          // Find line numbers where this variable appears
          const lines = content.split('\n');
          const referenceLines: number[] = [];

          for (let i = 0; i < lines.length; i++) {
            if (pattern.test(lines[i])) {
              referenceLines.push(i + 1);
            }
          }

          if (referenceLines.length > 0) {
            references.push(
              `${repository}:${filePath}:${referenceLines.join(',')}`
            );
          }
        }
      }

      dataFlowMap.set(dataElement, references);
    }

    return dataFlowMap;
  }

  /**
   * Find similar bug patterns in commit history
   */
  private async findSimilarBugCommits(
    keyTerms: string[]
  ): Promise<Array<{ sha: string; message: string; url: string }>> {
    const results: Array<{ sha: string; message: string; url: string }> = [];

    // Common bug-related terms to search for
    const bugTerms = [
      'fix',
      'bug',
      'issue',
      'error',
      'crash',
      'exception',
      'fail',
      'resolve',
    ];

    for (const repository of this.allowedRepositories) {
      try {
        const [owner, repo] = repository.split('/');

        // Get the octokit instance
        const octokit = await this.getOctokit(repository);

        // Combine key terms with bug terms for search
        for (const bugTerm of bugTerms) {
          // Search commits for this bug term and any of the key terms
          for (const keyTerm of keyTerms) {
            if (!keyTerm || keyTerm.length < 3) continue; // Skip very short terms

            try {
              const { data: commits } = await octokit.rest.search.commits({
                q: `repo:${owner}/${repo} ${bugTerm} ${keyTerm}`,
                per_page: 5,
              });

              for (const item of commits.items) {
                results.push({
                  sha: item.sha,
                  message: item.commit.message,
                  url: item.html_url,
                });

                // Limit the total number of commits
                if (results.length >= 10) {
                  return results;
                }
              }
            } catch (error) {
              console.error(
                `Error searching commits for "${bugTerm} ${keyTerm}" in ${repository}:`,
                error
              );
            }
          }
        }
      } catch (error) {
        console.error(`Error searching commits in ${repository}:`, error);
      }
    }

    return results;
  }

  /**
   * Helper methods
   */
  private getFileExtension(filePath: string): string | null {
    const match = filePath.match(/\.([^.]+)$/);
    return match ? match[1].toLowerCase() : null;
  }

  private isCodeFile(extension: string): boolean {
    const codeExtensions = [
      'js',
      'jsx',
      'ts',
      'tsx',
      'py',
      'rb',
      'php',
      'java',
      'go',
      'rs',
      'c',
      'cpp',
      'cs',
      'swift',
      'scala',
      'kt',
      'sh',
      'sql',
      'vue',
      'svelte',
    ];
    return codeExtensions.includes(extension);
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async searchCodeFiles(
    keywords: string[],
    repository: string
  ): Promise<CodeFile[]> {
    const results: CodeFile[] = [];
    const [owner, repo] = repository.split('/');

    try {
      // Get the octokit instance
      const octokit = await this.getOctokit(repository);

      // Search for all files in the repository
      const { data } = await octokit.rest.search.code({
        q: `repo:${repository} ${keywords.join(' ')}`,
        per_page: 100,
      });

      for (const item of data.items) {
        results.push({
          path: item.path,
          url: item.html_url,
          repository,
          content: '',
        });
      }
    } catch (error) {
      console.error(
        `Error searching code files in repository ${repository}:`,
        error
      );
    }

    return results;
  }

  async findRelatedCodeTerms(
    codeSnippet: string,
    repository: string
  ): Promise<string[]> {
    const terms: string[] = [];

    try {
      // Extract potential keywords from the code snippet
      const keywords = this.extractKeywords(codeSnippet);

      if (keywords.length === 0) {
        return terms;
      }

      // Get octokit instance
      const octokit = await this.getOctokit(repository);

      for (const keyword of keywords) {
        if (keyword.length < 3) continue; // Skip very short terms

        const { data } = await octokit.rest.search.code({
          q: `repo:${repository} ${keyword}`,
          per_page: 5,
        });

        if (data.total_count > 0) {
          terms.push(keyword);
        }

        if (terms.length >= 10) break; // Limit to 10 terms
      }
    } catch (error) {
      console.error(
        `Error finding related code terms for repository ${repository}:`,
        error
      );
    }

    return terms;
  }

  async getPastBugFixes(
    repository: string,
    filePath: string
  ): Promise<string[]> {
    const [owner, repo] = repository.split('/');
    const bugFixes: string[] = [];

    try {
      // Get octokit instance
      const octokit = await this.getOctokit(repository);

      const query = `repo:${repository} path:${filePath} fix bug issue type:commit`;

      const { data } = await octokit.rest.search.commits({
        q: query,
        per_page: 5,
        sort: 'committer-date',
        order: 'desc',
      });

      for (const item of data.items) {
        const message = item.commit.message;
        const sha = item.sha;
        bugFixes.push(
          `Commit ${sha.substring(0, 7)}: ${message.split('\n')[0]}`
        );
      }
    } catch (error) {
      console.error(
        `Error getting past bug fixes for file ${filePath} in repository ${repository}:`,
        error
      );
    }

    return bugFixes;
  }

  private extractKeywords(codeSnippet: string): string[] {
    const keywords: string[] = [];

    // Remove common syntax and split into words
    const cleanedCode = codeSnippet
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Extract potential keywords (camelCase, snake_case, etc.)
    const words = cleanedCode.split(' ');

    for (const word of words) {
      // Skip common keywords, numbers, and very short words
      if (
        !this.isCommonKeyword(word) &&
        !word.match(/^\d+$/) &&
        word.length > 2
      ) {
        keywords.push(word);
      }
    }

    return [...new Set(keywords)]; // Remove duplicates
  }

  private isCommonKeyword(word: string): boolean {
    const commonKeywords = [
      'if',
      'else',
      'for',
      'while',
      'do',
      'switch',
      'case',
      'break',
      'continue',
      'return',
      'function',
      'var',
      'let',
      'const',
      'class',
      'this',
      'new',
      'null',
      'undefined',
      'true',
      'false',
      'try',
      'catch',
      'finally',
      'throw',
      'async',
      'await',
      'import',
      'export',
      'from',
      'public',
      'private',
      'protected',
      'static',
      'interface',
      'type',
      'extends',
      'implements',
      'string',
      'number',
      'boolean',
      'any',
      'void',
      'object',
      'array',
      'get',
      'set',
      'default',
    ];

    return commonKeywords.includes(word.toLowerCase());
  }

  async analyzeCodebase(repository: string): Promise<CodebaseAnalysis> {
    try {
      const [owner, repo] = repository.split('/');
      const fileStats = await this.getFileStatistics(repository);
      const languages = await this.getLanguages(repository);
      const contributors = await this.getTopContributors(repository);
      const commitFrequency = await this.getCommitFrequency(repository);

      // Get recent commits
      const octokit = await this.getOctokit(repository);
      const { data: commits } = await octokit.rest.repos.listCommits({
        owner,
        repo,
        per_page: 10,
      });

      return {
        repository,
        fileStats,
        languages,
        contributors,
        commitFrequency,
        recentCommits: commits.map((commit) => ({
          sha: commit.sha,
          message: commit.commit.message,
          author: commit.commit.author?.name || 'Unknown',
          date: commit.commit.author?.date || new Date().toISOString(),
        })),
      };
    } catch (error) {
      console.error(`Error analyzing codebase for ${repository}:`, error);
      return {
        repository,
        fileStats: { totalFiles: 0, filesByExtension: {} },
        languages: {},
        contributors: [],
        commitFrequency: [],
        recentCommits: [],
      };
    }
  }

  async searchCode(
    repository: string,
    query: string,
    fileExtension?: string
  ): Promise<CodeSearchResult[]> {
    try {
      const octokit = await this.getOctokit(repository);
      let q = `repo:${repository} ${query}`;

      if (fileExtension) {
        q += ` extension:${fileExtension}`;
      }

      const response = await octokit.rest.search.code({
        q,
        per_page: 10,
      });

      return response.data.items.map((item) => ({
        repository,
        path: item.path,
        url: item.html_url,
        score: item.score,
      }));
    } catch (error) {
      console.error(`Error searching code in ${repository}:`, error);
      return [];
    }
  }

  async getLanguages(repository: string): Promise<Record<string, number>> {
    try {
      const [owner, repo] = repository.split('/');
      const octokit = await this.getOctokit(repository);
      const { data } = await octokit.rest.repos.listLanguages({
        owner,
        repo,
      });
      return data;
    } catch (error) {
      console.error(`Error getting languages for ${repository}:`, error);
      return {};
    }
  }

  async getTopContributors(
    repository: string
  ): Promise<{ name: string; commits: number }[]> {
    try {
      const [owner, repo] = repository.split('/');
      const octokit = await this.getOctokit(repository);
      const { data } = await octokit.rest.repos.listContributors({
        owner,
        repo,
        per_page: 10,
      });

      return data.map((contributor) => ({
        name: contributor.login || 'Anonymous',
        commits: contributor.contributions,
      }));
    } catch (error) {
      console.error(`Error getting contributors for ${repository}:`, error);
      return [];
    }
  }

  async getCommitFrequency(
    repository: string
  ): Promise<{ week: string; commits: number }[]> {
    try {
      const [owner, repo] = repository.split('/');
      const octokit = await this.getOctokit(repository);
      const { data } = await octokit.rest.repos.getCommitActivityStats({
        owner,
        repo,
      });

      return data.map((week) => ({
        week: new Date(week.week * 1000).toISOString().split('T')[0],
        commits: week.total,
      }));
    } catch (error) {
      console.error(`Error getting commit frequency for ${repository}:`, error);
      return [];
    }
  }
}
