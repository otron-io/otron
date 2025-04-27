import { Issue } from '@linear/sdk';
import OpenAI from 'openai';
import { env } from './env.js';
import { PRManager } from './pr-manager.js';
import { LocalRepositoryManager } from './repository-manager.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Define CodeFile interface
interface CodeFile {
  path: string;
  repository: string;
  content: string;
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
          // Try to get the file content from the local repo
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
   * Get statistics about file types in a repository using local git operations
   */
  async getFileStatistics(
    repository: string
  ): Promise<{ totalFiles: number; filesByExtension: Record<string, number> }> {
    try {
      const repoPath = await this.localRepoManager.ensureRepoCloned(repository);
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

      // Use git ls-files to count files by extension
      for (const ext of extensions) {
        try {
          const { stdout } = await execAsync(
            `cd ${repoPath} && git ls-files | grep -i '\\${ext}$' | wc -l`
          );
          const count = parseInt(stdout.trim(), 10);

          if (count > 0) {
            filesByExtension[ext] = count;
            totalFiles += count;
          }
        } catch (error) {
          console.error(`Error counting ${ext} files in ${repository}:`, error);
        }
      }

      return { totalFiles, filesByExtension };
    } catch (error) {
      console.error(`Error getting file statistics for ${repository}:`, error);
      return { totalFiles: 0, filesByExtension: {} };
    }
  }

  /**
   * Get languages used in the repository based on file extensions
   */
  async getLanguages(repository: string): Promise<Record<string, number>> {
    try {
      const { totalFiles, filesByExtension } = await this.getFileStatistics(
        repository
      );

      // Map file extensions to languages and calculate percentages
      const extensionToLanguage: Record<string, string> = {
        '.js': 'JavaScript',
        '.jsx': 'JavaScript',
        '.ts': 'TypeScript',
        '.tsx': 'TypeScript',
        '.py': 'Python',
        '.java': 'Java',
        '.rb': 'Ruby',
        '.go': 'Go',
        '.php': 'PHP',
        '.cs': 'C#',
        '.cpp': 'C++',
        '.html': 'HTML',
        '.css': 'CSS',
        '.json': 'JSON',
      };

      const languages: Record<string, number> = {};

      for (const [ext, count] of Object.entries(filesByExtension)) {
        const language = extensionToLanguage[ext] || 'Other';
        languages[language] = (languages[language] || 0) + count;
      }

      return languages;
    } catch (error) {
      console.error(`Error getting languages for ${repository}:`, error);
      return {};
    }
  }

  /**
   * Get top contributors using local git operations
   */
  async getTopContributors(
    repository: string
  ): Promise<{ name: string; commits: number }[]> {
    try {
      const repoPath = await this.localRepoManager.ensureRepoCloned(repository);

      // Use git shortlog to get contributors
      const { stdout } = await execAsync(
        `cd ${repoPath} && git shortlog -sn --no-merges | head -10`
      );

      const contributors: { name: string; commits: number }[] = [];

      // Parse the shortlog output
      // Format is: numCommits\tAuthor Name
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        const match = line.trim().match(/^\s*(\d+)\s+(.+)$/);
        if (match) {
          contributors.push({
            name: match[2],
            commits: parseInt(match[1], 10),
          });
        }
      }

      return contributors;
    } catch (error) {
      console.error(`Error getting contributors for ${repository}:`, error);
      return [];
    }
  }

  /**
   * Get commit frequency using local git operations
   */
  async getCommitFrequency(
    repository: string
  ): Promise<{ week: string; commits: number }[]> {
    try {
      const repoPath = await this.localRepoManager.ensureRepoCloned(repository);

      // Get commits by week for the last 10 weeks
      const { stdout } = await execAsync(
        `cd ${repoPath} && git log --format=format:%ai --no-merges -n 1000`
      );

      const dates = stdout
        .trim()
        .split('\n')
        .map((line) => line.substring(0, 10));

      // Group by week
      const weekCounts = new Map<string, number>();
      const now = new Date();

      // Initialize with the last 10 weeks
      for (let i = 0; i < 10; i++) {
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - i * 7);
        const weekString = weekStart.toISOString().split('T')[0];
        weekCounts.set(weekString, 0);
      }

      // Count commits per week
      for (const date of dates) {
        const weekStart = new Date(date);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Set to start of week (Sunday)
        const weekString = weekStart.toISOString().split('T')[0];

        weekCounts.set(weekString, (weekCounts.get(weekString) || 0) + 1);
      }

      // Convert to array and sort by date
      const result = Array.from(weekCounts.entries())
        .map(([week, commits]) => ({ week, commits }))
        .sort((a, b) => a.week.localeCompare(b.week));

      return result;
    } catch (error) {
      console.error(`Error getting commit frequency for ${repository}:`, error);
      return [];
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
   * Search for additional files based on key terms using local operations
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

    // Limit to top 5 most specific terms to avoid too many operations
    const searchTerms = sortedTerms.slice(0, 5);

    for (const term of searchTerms) {
      if (!term || term.length < 3) continue; // Skip very short terms

      for (const repository of this.allowedRepositories) {
        try {
          const repoPath = await this.localRepoManager.ensureRepoCloned(
            repository
          );

          // Use git grep to search for the term
          const escapedTerm = this.escapeRegExp(term);
          const { stdout } = await execAsync(
            `cd ${repoPath} && git grep -l "${escapedTerm}" -- "*.js" "*.ts" "*.jsx" "*.tsx" "*.py" "*.rb" "*.java" | head -20`
          );

          if (!stdout.trim()) continue;

          const filePaths = stdout.trim().split('\n');

          // For each result, get the file content
          for (const filePath of filePaths) {
            const fileKey = `${repository}:${filePath.trim()}`;

            // Skip if we already have this file
            if (processedFiles.has(fileKey)) {
              continue;
            }

            try {
              // Get file content using localRepoManager
              const content = await this.localRepoManager.getFileContent(
                filePath.trim(),
                repository
              );

              results.push({
                path: filePath.trim(),
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
   * Find similar bug patterns in commit history using local git commands
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
        const repoPath = await this.localRepoManager.ensureRepoCloned(
          repository
        );
        const [owner, repo] = repository.split('/');

        // Combine key terms with bug terms for search
        for (const bugTerm of bugTerms) {
          // Search commits for this bug term and any of the key terms
          for (const keyTerm of keyTerms) {
            if (!keyTerm || keyTerm.length < 3) continue; // Skip very short terms

            try {
              // Use git log to search commit messages
              const escapedBugTerm = this.escapeRegExp(bugTerm);
              const escapedKeyTerm = this.escapeRegExp(keyTerm);
              const { stdout } = await execAsync(
                `cd ${repoPath} && git log --grep="${escapedBugTerm}" --grep="${escapedKeyTerm}" --format=format:"%H||%an||%ad||%s" -n 5`
              );

              if (!stdout.trim()) continue;

              const commits = stdout.trim().split('\n');

              for (const commit of commits) {
                const [sha, author, date, message] = commit.split('||');

                results.push({
                  sha,
                  message,
                  url: `https://github.com/${owner}/${repo}/commit/${sha}`,
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

    try {
      const repoPath = await this.localRepoManager.ensureRepoCloned(repository);

      // Build a grep command that searches for all keywords
      const grepPattern = keywords.map((k) => this.escapeRegExp(k)).join('|');
      const { stdout } = await execAsync(
        `cd ${repoPath} && git grep -l -E "${grepPattern}" -- "*.js" "*.ts" "*.jsx" "*.tsx" "*.py" "*.rb" "*.java" | head -100`
      );

      if (!stdout.trim()) return results;

      const filePaths = stdout.trim().split('\n');

      // Load content for each file
      for (const filePath of filePaths) {
        try {
          const content = await this.localRepoManager.getFileContent(
            filePath.trim(),
            repository
          );

          results.push({
            path: filePath.trim(),
            repository,
            content,
          });
        } catch (error) {
          console.error(`Error reading file ${filePath}:`, error);
        }
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

      const repoPath = await this.localRepoManager.ensureRepoCloned(repository);

      for (const keyword of keywords) {
        if (keyword.length < 3) continue; // Skip very short terms

        try {
          const escapedKeyword = this.escapeRegExp(keyword);
          const { stdout } = await execAsync(
            `cd ${repoPath} && git grep -l -w "${escapedKeyword}" | wc -l`
          );

          const count = parseInt(stdout.trim(), 10);

          if (count > 0) {
            terms.push(keyword);
          }

          if (terms.length >= 10) break; // Limit to 10 terms
        } catch (error) {
          console.error(`Error searching for keyword ${keyword}:`, error);
        }
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
    const bugFixes: string[] = [];

    try {
      const repoPath = await this.localRepoManager.ensureRepoCloned(repository);

      // Look for bug-related terms in commit messages that touch this file
      const { stdout } = await execAsync(
        `cd ${repoPath} && git log --grep="\\(fix\\|bug\\|issue\\|error\\)" --format=format:"%h: %s" -- "${filePath}" | head -5`
      );

      if (stdout.trim()) {
        const lines = stdout.trim().split('\n');
        bugFixes.push(...lines);
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
      const fileStats = await this.getFileStatistics(repository);
      const languages = await this.getLanguages(repository);
      const contributors = await this.getTopContributors(repository);
      const commitFrequency = await this.getCommitFrequency(repository);
      const recentCommits = await this.getRecentCommits(repository);

      return {
        repository,
        fileStats,
        languages,
        contributors,
        commitFrequency,
        recentCommits,
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

  /**
   * Get recent commits using local git operations
   */
  private async getRecentCommits(repository: string): Promise<
    Array<{
      sha: string;
      message: string;
      author: string;
      date: string;
    }>
  > {
    try {
      const repoPath = await this.localRepoManager.ensureRepoCloned(repository);
      const [owner, repo] = repository.split('/');

      // Get recent commits
      const { stdout } = await execAsync(
        `cd ${repoPath} && git log --format=format:"%H||%an||%ad||%s" -n 10`
      );

      if (!stdout.trim()) return [];

      const commits = stdout
        .trim()
        .split('\n')
        .map((line) => {
          const [sha, author, date, message] = line.split('||');
          return {
            sha,
            message,
            author,
            date,
          };
        });

      return commits;
    } catch (error) {
      console.error(`Error getting recent commits for ${repository}:`, error);
      return [];
    }
  }

  /**
   * Search code in the repository using local git grep
   */
  async searchCode(
    repository: string,
    query: string,
    fileExtension?: string
  ): Promise<CodeSearchResult[]> {
    try {
      const repoPath = await this.localRepoManager.ensureRepoCloned(repository);
      const escapedQuery = this.escapeRegExp(query);

      // Build the git grep command
      let grepCommand = `cd ${repoPath} && git grep -l "${escapedQuery}"`;

      // Add file extension filter if specified
      if (fileExtension) {
        grepCommand += ` -- "*.${fileExtension}"`;
      }

      // Limit results
      grepCommand += ' | head -20';

      const { stdout } = await execAsync(grepCommand);

      if (!stdout.trim()) return [];

      // Process results
      const filePaths = stdout.trim().split('\n');
      return filePaths.map((path, index) => ({
        repository,
        path: path.trim(),
        score: 100 - index, // Simulate a score (higher = better match)
      }));
    } catch (error) {
      console.error(`Error searching code in ${repository}:`, error);
      return [];
    }
  }
}
