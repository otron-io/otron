import path from 'path';
import { LocalRepositoryManager } from './repository-manager.js';

/**
 * CodeAnalyzer for analyzing code relationships and dependencies
 */
export class CodeAnalyzer {
  constructor(private repoManager: LocalRepositoryManager) {}

  /**
   * Build a dependency graph for an array of files
   */
  async buildDependencyGraph(
    files: Array<{ path: string; repository: string }>
  ): Promise<Map<string, string[]>> {
    // Ensure all files have their content loaded
    const filesWithContent = await Promise.all(
      files.map(async (file) => {
        try {
          const content = await this.repoManager.getFileContent(
            file.path,
            file.repository
          );
          return {
            ...file,
            content,
          };
        } catch (error) {
          console.error(`Error loading content for file ${file.path}:`, error);
          return {
            ...file,
            content: '',
          };
        }
      })
    );

    // Initialize the graph - mapping file paths to their dependencies
    const graph = new Map<string, string[]>();

    // Process each file to find imports and relationships
    for (const file of filesWithContent) {
      if (!file.content) continue;

      const importedPaths = this.extractImports(file.path, file.content);

      // Add file to the graph if not already there
      if (!graph.has(file.path)) {
        graph.set(file.path, []);
      }

      // For each imported path, find the corresponding file in our files array
      for (const importPath of importedPaths) {
        const resolvedPath = this.resolveImportPath(file.path, importPath);

        // Check if the resolved path exists in our files
        const targetFile = filesWithContent.find(
          (f) => f.path === resolvedPath || f.path.endsWith(`/${resolvedPath}`)
        );

        if (targetFile) {
          // Add dependency relationship
          const dependencies = graph.get(file.path) || [];
          if (!dependencies.includes(targetFile.path)) {
            dependencies.push(targetFile.path);
            graph.set(file.path, dependencies);
          }
        }
      }
    }

    return graph;
  }

  /**
   * Extract imports from a file
   */
  private extractImports(filePath: string, content: string): string[] {
    const imports: string[] = [];
    const fileExt = path.extname(filePath).toLowerCase();

    // Handle JavaScript/TypeScript files
    if (['.js', '.jsx', '.ts', '.tsx'].includes(fileExt)) {
      // Match ES imports
      const esImportRegex =
        /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g;
      let match;
      while ((match = esImportRegex.exec(content)) !== null) {
        imports.push(match[1]);
      }

      // Match require statements
      const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((match = requireRegex.exec(content)) !== null) {
        imports.push(match[1]);
      }
    }
    // Handle Python files
    else if (fileExt === '.py') {
      // Match Python imports
      const importRegex = /(?:from\s+(\S+)\s+import)|(?:import\s+(\S+))/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1] || match[2];
        if (importPath) {
          imports.push(importPath.replace(/\./g, '/'));
        }
      }
    }

    return imports;
  }

  /**
   * Resolve an import path relative to the importing file
   */
  private resolveImportPath(filePath: string, importPath: string): string {
    // Handle relative imports
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
      const directory = path.dirname(filePath);
      return path.normalize(`${directory}/${importPath}`);
    }

    // For non-relative imports, just return the import path
    return importPath;
  }

  /**
   * Extract function and class definitions from a file
   */
  async extractDefinitions(
    filePath: string,
    repository: string
  ): Promise<
    Array<{
      name: string;
      type: 'function' | 'class';
      start: number;
      end: number;
    }>
  > {
    try {
      const content = await this.repoManager.getFileContent(
        filePath,
        repository
      );
      const fileExt = path.extname(filePath).toLowerCase();
      const definitions: Array<{
        name: string;
        type: 'function' | 'class';
        start: number;
        end: number;
      }> = [];

      // Handle JavaScript/TypeScript files
      if (['.js', '.jsx', '.ts', '.tsx'].includes(fileExt)) {
        // Match function declarations/expressions
        const functionRegex =
          /(?:function\s+(\w+))|(?:const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)|(?:(\w+)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>)|(?:(\w+)\s*=\s*function)/g;
        let match;
        let lineIndex = 0;
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          while ((match = functionRegex.exec(line)) !== null) {
            const name = match[1] || match[2] || match[3] || match[4];
            if (name) {
              definitions.push({
                name,
                type: 'function',
                start: i + 1, // Line numbers are 1-based
                end: this.findClosingBrace(lines, i) || i + 1,
              });
            }
          }
        }

        // Match class declarations
        const classRegex = /class\s+(\w+)/g;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          while ((match = classRegex.exec(line)) !== null) {
            if (match[1]) {
              definitions.push({
                name: match[1],
                type: 'class',
                start: i + 1,
                end: this.findClosingBrace(lines, i) || i + 1,
              });
            }
          }
        }
      }
      // Handle Python files
      else if (fileExt === '.py') {
        // Match Python function and class definitions
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // Check for function definition
          const funcMatch = line.match(/^\s*def\s+(\w+)\s*\(/);
          if (funcMatch && funcMatch[1]) {
            definitions.push({
              name: funcMatch[1],
              type: 'function',
              start: i + 1,
              end: this.findPythonBlockEnd(lines, i) || i + 1,
            });
          }

          // Check for class definition
          const classMatch = line.match(/^\s*class\s+(\w+)/);
          if (classMatch && classMatch[1]) {
            definitions.push({
              name: classMatch[1],
              type: 'class',
              start: i + 1,
              end: this.findPythonBlockEnd(lines, i) || i + 1,
            });
          }
        }
      }

      return definitions;
    } catch (error) {
      console.error(`Error extracting definitions from ${filePath}:`, error);
      return [];
    }
  }

  /**
   * Extract function and method calls from a file
   */
  async extractFunctionCalls(
    filePath: string,
    repository: string
  ): Promise<Array<{ name: string; line: number }>> {
    try {
      const content = await this.repoManager.getFileContent(
        filePath,
        repository
      );
      const fileExt = path.extname(filePath).toLowerCase();
      const calls: Array<{ name: string; line: number }> = [];

      // Handle JavaScript/TypeScript files
      if (['.js', '.jsx', '.ts', '.tsx'].includes(fileExt)) {
        // Match function/method calls - this is a simplified regex and may not catch all cases
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // Match method calls (obj.method())
          const methodRegex = /(\w+)\.(\w+)\s*\(/g;
          let match;

          while ((match = methodRegex.exec(line)) !== null) {
            const methodName = match[2];
            // Skip common built-ins and keywords
            if (
              !['if', 'for', 'while', 'switch', 'catch'].includes(methodName)
            ) {
              calls.push({
                name: methodName,
                line: i + 1,
              });
            }
          }

          // Match direct function calls (func())
          const funcRegex = /(?<!\.\s*)(\b\w+)\s*\(/g;
          while ((match = funcRegex.exec(line)) !== null) {
            const funcName = match[1];
            // Skip common built-ins and keywords
            if (
              ![
                'if',
                'for',
                'while',
                'switch',
                'catch',
                'function',
                'return',
              ].includes(funcName)
            ) {
              calls.push({
                name: funcName,
                line: i + 1,
              });
            }
          }
        }
      }
      // Handle Python files
      else if (fileExt === '.py') {
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // Match method calls (obj.method())
          const methodRegex = /(\w+)\.(\w+)\s*\(/g;
          let match;

          while ((match = methodRegex.exec(line)) !== null) {
            calls.push({
              name: match[2],
              line: i + 1,
            });
          }

          // Match direct function calls (func())
          const funcRegex = /(?<!\.\s*)(\b\w+)\s*\(/g;
          while ((match = funcRegex.exec(line)) !== null) {
            const funcName = match[1];
            // Skip common Python built-ins and keywords
            if (
              ![
                'if',
                'for',
                'while',
                'def',
                'class',
                'print',
                'len',
                'range',
                'int',
                'str',
                'list',
                'dict',
              ].includes(funcName)
            ) {
              calls.push({
                name: funcName,
                line: i + 1,
              });
            }
          }
        }
      }

      return calls;
    } catch (error) {
      console.error(`Error extracting function calls from ${filePath}:`, error);
      return [];
    }
  }

  /**
   * Find where a function, method, or class is used in the provided files
   */
  async findUsages(
    name: string,
    files: Array<{ path: string; repository: string }>
  ): Promise<Array<{ path: string; line: number; context: string }>> {
    const usages: Array<{ path: string; line: number; context: string }> = [];

    for (const file of files) {
      try {
        const content = await this.repoManager.getFileContent(
          file.path,
          file.repository
        );
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // Look for usage of the name
          const regex = new RegExp(`\\b${name}\\b`, 'g');
          if (regex.test(line)) {
            usages.push({
              path: file.path,
              line: i + 1,
              context: line.trim(),
            });
          }
        }
      } catch (error) {
        console.error(`Error finding usages in ${file.path}:`, error);
      }
    }

    return usages;
  }

  /**
   * Helper method to find the end of a code block (closing brace) for JS/TS files
   */
  private findClosingBrace(lines: string[], startIndex: number): number | null {
    let braceCount = 0;
    let foundOpeningBrace = false;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];

      // Count opening braces
      for (let j = 0; j < line.length; j++) {
        if (line[j] === '{') {
          foundOpeningBrace = true;
          braceCount++;
        } else if (line[j] === '}') {
          braceCount--;

          // If we found the matching closing brace
          if (foundOpeningBrace && braceCount === 0) {
            return i + 1;
          }
        }
      }
    }

    return null;
  }

  /**
   * Helper method to find the end of a Python block based on indentation
   */
  private findPythonBlockEnd(
    lines: string[],
    startIndex: number
  ): number | null {
    // Find the indentation level of the definition line
    const defLine = lines[startIndex];
    const match = defLine.match(/^(\s*)/);
    const baseIndent = match ? match[1].length : 0;

    // Find the first line with equal or less indentation
    for (let i = startIndex + 1; i < lines.length; i++) {
      const line = lines[i];

      // Skip empty lines
      if (line.trim() === '') continue;

      const indentMatch = line.match(/^(\s*)/);
      const currentIndent = indentMatch ? indentMatch[1].length : 0;

      if (currentIndent <= baseIndent) {
        return i;
      }
    }

    // If we reached the end of the file, return the last line
    return lines.length;
  }
}
