import { getFileContent } from './github-utils.js';

export interface FileAnalysis {
  path: string;
  language: string;
  totalLines: number;
  functions: Array<{
    name: string;
    startLine: number;
    endLine: number;
    parameters?: string[];
    returnType?: string;
  }>;
  classes: Array<{
    name: string;
    startLine: number;
    endLine: number;
    methods: string[];
  }>;
  imports: Array<{
    module: string;
    line: number;
    type: 'import' | 'require' | 'from';
  }>;
  exports: Array<{
    name: string;
    line: number;
    type: 'default' | 'named' | 'all';
  }>;
  comments: Array<{
    line: number;
    type: 'single' | 'multi' | 'doc';
    content: string;
  }>;
  dependencies: string[];
  complexity: {
    cyclomaticComplexity: number;
    cognitiveComplexity: number;
    maintainabilityIndex: number;
  };
}

export interface CodeContext {
  beforeLines: string[];
  targetLines: string[];
  afterLines: string[];
  lineNumbers: {
    start: number;
    end: number;
    total: number;
  };
}

/**
 * Advanced file reader with intelligent code analysis capabilities
 */
export class AdvancedFileReader {
  /**
   * Read file with intelligent context - automatically determines optimal line range
   */
  async readFileWithContext(
    path: string,
    repository: string,
    options: {
      targetLine?: number;
      searchPattern?: string;
      functionName?: string;
      className?: string;
      contextLines?: number;
      maxLines?: number;
      branch?: string;
      sessionId?: string;
    } = {}
  ): Promise<CodeContext> {
    const {
      targetLine,
      searchPattern,
      functionName,
      className,
      contextLines = 10,
      maxLines = 200,
      branch,
      sessionId,
    } = options;

    // First, get the full file to analyze structure
    const fullContent = await getFileContent(
      path,
      repository,
      1,
      10000,
      branch,
      sessionId
    );
    const lines = fullContent.split('\n');
    const totalLines = lines.length;

    let startLine = 1;
    let endLine = Math.min(totalLines, maxLines);

    // If specific target is provided, focus around it
    if (targetLine) {
      startLine = Math.max(1, targetLine - contextLines);
      endLine = Math.min(totalLines, targetLine + contextLines);
    } else if (searchPattern) {
      const matchLine = this.findPatternInLines(lines, searchPattern);
      if (matchLine > 0) {
        startLine = Math.max(1, matchLine - contextLines);
        endLine = Math.min(totalLines, matchLine + contextLines);
      }
    } else if (functionName) {
      const functionRange = this.findFunctionRange(lines, functionName);
      if (functionRange) {
        startLine = Math.max(1, functionRange.start - contextLines);
        endLine = Math.min(totalLines, functionRange.end + contextLines);
      }
    } else if (className) {
      const classRange = this.findClassRange(lines, className);
      if (classRange) {
        startLine = Math.max(1, classRange.start - contextLines);
        endLine = Math.min(totalLines, classRange.end + contextLines);
      }
    }

    // Ensure we don't exceed maxLines
    if (endLine - startLine + 1 > maxLines) {
      endLine = startLine + maxLines - 1;
    }

    const beforeLines = startLine > 1 ? lines.slice(0, startLine - 1) : [];
    const targetLines = lines.slice(startLine - 1, endLine);
    const afterLines = endLine < totalLines ? lines.slice(endLine) : [];

    return {
      beforeLines,
      targetLines,
      afterLines,
      lineNumbers: {
        start: startLine,
        end: endLine,
        total: totalLines,
      },
    };
  }

  /**
   * Analyze file structure and extract metadata
   */
  async analyzeFileStructure(
    path: string,
    repository: string,
    branch?: string
  ): Promise<FileAnalysis> {
    const content = await getFileContent(path, repository, 1, 10000, branch);
    const lines = content.split('\n');
    const language = this.detectLanguage(path);

    const analysis: FileAnalysis = {
      path,
      language,
      totalLines: lines.length,
      functions: this.extractFunctions(lines, language),
      classes: this.extractClasses(lines, language),
      imports: this.extractImports(lines, language),
      exports: this.extractExports(lines, language),
      comments: this.extractComments(lines, language),
      dependencies: this.extractDependencies(lines, language),
      complexity: this.calculateComplexity(lines, language),
    };

    return analysis;
  }

  /**
   * Read multiple related files with intelligent context
   */
  async readRelatedFiles(
    mainPath: string,
    repository: string,
    options: {
      includeImports?: boolean;
      includeTests?: boolean;
      includeTypes?: boolean;
      maxFiles?: number;
      branch?: string;
    } = {}
  ): Promise<Array<{ path: string; content: string; relationship: string }>> {
    const {
      includeImports = true,
      includeTests = true,
      includeTypes = true,
      maxFiles = 5,
      branch,
    } = options;

    const results: Array<{
      path: string;
      content: string;
      relationship: string;
    }> = [];

    // Add main file
    const mainContent = await getFileContent(
      mainPath,
      repository,
      1,
      200,
      branch
    );
    results.push({
      path: mainPath,
      content: mainContent,
      relationship: 'main',
    });

    if (includeImports) {
      const imports = this.extractImports(
        mainContent.split('\n'),
        this.detectLanguage(mainPath)
      );
      for (const imp of imports.slice(0, maxFiles - 1)) {
        try {
          const importPath = this.resolveImportPath(imp.module, mainPath);
          if (importPath) {
            const content = await getFileContent(
              importPath,
              repository,
              1,
              100,
              branch
            );
            results.push({
              path: importPath,
              content,
              relationship: 'import',
            });
          }
        } catch (error) {
          // Skip files that can't be read
        }
      }
    }

    if (includeTests) {
      const testPaths = this.generateTestPaths(mainPath);
      for (const testPath of testPaths.slice(0, 2)) {
        try {
          const content = await getFileContent(
            testPath,
            repository,
            1,
            100,
            branch
          );
          results.push({
            path: testPath,
            content,
            relationship: 'test',
          });
        } catch (error) {
          // Skip test files that don't exist
        }
      }
    }

    if (includeTypes && this.detectLanguage(mainPath) === 'typescript') {
      const typePaths = this.generateTypePaths(mainPath);
      for (const typePath of typePaths.slice(0, 2)) {
        try {
          const content = await getFileContent(
            typePath,
            repository,
            1,
            100,
            branch
          );
          results.push({
            path: typePath,
            content,
            relationship: 'types',
          });
        } catch (error) {
          // Skip type files that don't exist
        }
      }
    }

    return results.slice(0, maxFiles);
  }

  /**
   * Search for patterns across multiple files with context
   */
  async searchWithContext(
    pattern: string,
    repository: string,
    options: {
      filePattern?: string;
      contextLines?: number;
      maxResults?: number;
      branch?: string;
    } = {}
  ): Promise<
    Array<{
      path: string;
      matches: Array<{
        line: number;
        content: string;
        context: string[];
      }>;
    }>
  > {
    // This would integrate with the existing search functionality
    // but provide enhanced context around matches
    const { contextLines = 3, maxResults = 10 } = options;

    // Implementation would use existing search tools but enhance with context
    return [];
  }

  // Helper methods for code analysis

  private detectLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      cs: 'csharp',
      go: 'go',
      rs: 'rust',
      php: 'php',
      rb: 'ruby',
      swift: 'swift',
      kt: 'kotlin',
      scala: 'scala',
      sh: 'shell',
      bash: 'shell',
      zsh: 'shell',
      fish: 'shell',
      ps1: 'powershell',
      sql: 'sql',
      html: 'html',
      css: 'css',
      scss: 'scss',
      sass: 'sass',
      less: 'less',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      xml: 'xml',
      md: 'markdown',
      dockerfile: 'dockerfile',
    };
    return languageMap[ext || ''] || 'text';
  }

  private findPatternInLines(lines: string[], pattern: string): number {
    const regex = new RegExp(pattern, 'i');
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        return i + 1; // Return 1-based line number
      }
    }
    return -1;
  }

  private findFunctionRange(
    lines: string[],
    functionName: string
  ): { start: number; end: number } | null {
    const functionRegex = new RegExp(
      `(function\\s+${functionName}|${functionName}\\s*[=:]|const\\s+${functionName}\\s*=|${functionName}\\s*\\()`,
      'i'
    );

    for (let i = 0; i < lines.length; i++) {
      if (functionRegex.test(lines[i])) {
        const start = i + 1;
        let end = start;
        let braceCount = 0;
        let inFunction = false;

        // Find the end of the function
        for (let j = i; j < lines.length; j++) {
          const line = lines[j];
          if (line.includes('{')) {
            braceCount += (line.match(/\{/g) || []).length;
            inFunction = true;
          }
          if (line.includes('}')) {
            braceCount -= (line.match(/\}/g) || []).length;
          }
          if (inFunction && braceCount === 0) {
            end = j + 1;
            break;
          }
        }

        return { start, end };
      }
    }
    return null;
  }

  private findClassRange(
    lines: string[],
    className: string
  ): { start: number; end: number } | null {
    const classRegex = new RegExp(`class\\s+${className}`, 'i');

    for (let i = 0; i < lines.length; i++) {
      if (classRegex.test(lines[i])) {
        const start = i + 1;
        let end = start;
        let braceCount = 0;
        let inClass = false;

        // Find the end of the class
        for (let j = i; j < lines.length; j++) {
          const line = lines[j];
          if (line.includes('{')) {
            braceCount += (line.match(/\{/g) || []).length;
            inClass = true;
          }
          if (line.includes('}')) {
            braceCount -= (line.match(/\}/g) || []).length;
          }
          if (inClass && braceCount === 0) {
            end = j + 1;
            break;
          }
        }

        return { start, end };
      }
    }
    return null;
  }

  private extractFunctions(
    lines: string[],
    language: string
  ): FileAnalysis['functions'] {
    const functions: FileAnalysis['functions'] = [];

    // Language-specific function patterns
    const patterns: Record<string, RegExp[]> = {
      typescript: [
        /function\s+(\w+)\s*\(/,
        /const\s+(\w+)\s*=\s*\(/,
        /(\w+)\s*\(/,
        /async\s+function\s+(\w+)/,
        /(\w+)\s*:\s*\(/,
      ],
      javascript: [
        /function\s+(\w+)\s*\(/,
        /const\s+(\w+)\s*=\s*\(/,
        /(\w+)\s*\(/,
        /async\s+function\s+(\w+)/,
      ],
      python: [/def\s+(\w+)\s*\(/, /async\s+def\s+(\w+)\s*\(/],
    };

    const langPatterns = patterns[language] || patterns.typescript;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      for (const pattern of langPatterns) {
        const match = line.match(pattern);
        if (match && match[1]) {
          const range = this.findFunctionRange(lines, match[1]);
          if (range) {
            functions.push({
              name: match[1],
              startLine: range.start,
              endLine: range.end,
            });
          }
        }
      }
    }

    return functions;
  }

  private extractClasses(
    lines: string[],
    language: string
  ): FileAnalysis['classes'] {
    const classes: FileAnalysis['classes'] = [];

    const classPattern = /class\s+(\w+)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const match = line.match(classPattern);
      if (match && match[1]) {
        const range = this.findClassRange(lines, match[1]);
        if (range) {
          classes.push({
            name: match[1],
            startLine: range.start,
            endLine: range.end,
            methods: [], // Could be enhanced to extract methods
          });
        }
      }
    }

    return classes;
  }

  private extractImports(
    lines: string[],
    language: string
  ): FileAnalysis['imports'] {
    const imports: FileAnalysis['imports'] = [];

    const patterns: Record<string, RegExp[]> = {
      typescript: [
        /import\s+.*\s+from\s+['"]([^'"]+)['"]/,
        /import\s+['"]([^'"]+)['"]/,
        /require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
      ],
      javascript: [
        /import\s+.*\s+from\s+['"]([^'"]+)['"]/,
        /import\s+['"]([^'"]+)['"]/,
        /require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
      ],
      python: [/import\s+(\w+)/, /from\s+(\w+)\s+import/],
    };

    const langPatterns = patterns[language] || patterns.typescript;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      for (const pattern of langPatterns) {
        const match = line.match(pattern);
        if (match && match[1]) {
          imports.push({
            module: match[1],
            line: i + 1,
            type: line.includes('from')
              ? 'from'
              : line.includes('require')
              ? 'require'
              : 'import',
          });
        }
      }
    }

    return imports;
  }

  private extractExports(
    lines: string[],
    language: string
  ): FileAnalysis['exports'] {
    const exports: FileAnalysis['exports'] = [];

    const patterns = [
      /export\s+default\s+(\w+)/,
      /export\s+\{([^}]+)\}/,
      /export\s+const\s+(\w+)/,
      /export\s+function\s+(\w+)/,
      /export\s+class\s+(\w+)/,
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match && match[1]) {
          exports.push({
            name: match[1],
            line: i + 1,
            type: line.includes('default') ? 'default' : 'named',
          });
        }
      }
    }

    return exports;
  }

  private extractComments(
    lines: string[],
    language: string
  ): FileAnalysis['comments'] {
    const comments: FileAnalysis['comments'] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('//')) {
        comments.push({
          line: i + 1,
          type: 'single',
          content: line.substring(2).trim(),
        });
      } else if (line.startsWith('/*') || line.startsWith('/**')) {
        comments.push({
          line: i + 1,
          type: line.startsWith('/**') ? 'doc' : 'multi',
          content: line,
        });
      } else if (
        line.startsWith('#') &&
        (language === 'python' || language === 'shell')
      ) {
        comments.push({
          line: i + 1,
          type: 'single',
          content: line.substring(1).trim(),
        });
      }
    }

    return comments;
  }

  private extractDependencies(lines: string[], language: string): string[] {
    const dependencies = new Set<string>();

    for (const line of lines) {
      // Extract from package.json-like dependencies
      const depMatch = line.match(/"([^"]+)":\s*"[^"]+"/);
      if (depMatch && depMatch[1] && !depMatch[1].startsWith('@types/')) {
        dependencies.add(depMatch[1]);
      }
    }

    return Array.from(dependencies);
  }

  private calculateComplexity(
    lines: string[],
    language: string
  ): FileAnalysis['complexity'] {
    // Simplified complexity calculation
    let cyclomaticComplexity = 1; // Base complexity
    let cognitiveComplexity = 0;

    const complexityKeywords = [
      'if',
      'else',
      'while',
      'for',
      'switch',
      'case',
      'catch',
      'try',
    ];

    for (const line of lines) {
      for (const keyword of complexityKeywords) {
        if (line.includes(keyword)) {
          cyclomaticComplexity++;
          cognitiveComplexity++;
        }
      }
    }

    const maintainabilityIndex = Math.max(
      0,
      171 - 5.2 * Math.log(lines.length) - 0.23 * cyclomaticComplexity
    );

    return {
      cyclomaticComplexity,
      cognitiveComplexity,
      maintainabilityIndex,
    };
  }

  private resolveImportPath(
    module: string,
    currentPath: string
  ): string | null {
    // Simplified import resolution
    if (module.startsWith('./') || module.startsWith('../')) {
      const dir = currentPath.split('/').slice(0, -1).join('/');
      return `${dir}/${module}`;
    }
    return null;
  }

  private generateTestPaths(mainPath: string): string[] {
    const dir = mainPath.split('/').slice(0, -1).join('/');
    const filename = mainPath
      .split('/')
      .pop()
      ?.replace(/\.(ts|js)$/, '');

    return [
      `${dir}/${filename}.test.ts`,
      `${dir}/${filename}.test.js`,
      `${dir}/__tests__/${filename}.test.ts`,
      `${dir}/__tests__/${filename}.test.js`,
      `tests/${filename}.test.ts`,
      `test/${filename}.test.ts`,
    ];
  }

  private generateTypePaths(mainPath: string): string[] {
    const dir = mainPath.split('/').slice(0, -1).join('/');
    const filename = mainPath
      .split('/')
      .pop()
      ?.replace(/\.(ts|js)$/, '');

    return [
      `${dir}/${filename}.d.ts`,
      `${dir}/types/${filename}.ts`,
      `types/${filename}.ts`,
      `@types/${filename}/index.d.ts`,
    ];
  }
}

// Export a singleton instance for easy use
export const advancedFileReader = new AdvancedFileReader();
