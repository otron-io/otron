import { getFileContent, createOrUpdateFile } from './github-utils.js';

export interface LineRange {
  start: number;
  end: number;
}

export interface EditOperation {
  type: 'insert' | 'replace' | 'delete';
  line?: number; // For insert operations
  range?: LineRange; // For replace/delete operations
  content?: string; // For insert/replace operations
}

export interface FileEdit {
  path: string;
  repository: string;
  branch: string;
  operations: EditOperation[];
  message: string;
}

/**
 * Advanced file editor that provides precise editing capabilities
 */
export class FileEditor {
  /**
   * Apply multiple edit operations to a file
   */
  static async applyEdits(edit: FileEdit): Promise<void> {
    const { path, repository, branch, operations, message } = edit;

    // Get current file content
    const currentContent = await getFileContent(
      path,
      repository,
      1,
      10000,
      branch
    );

    // Remove the line info header if present
    const lines = currentContent.split('\n');
    let actualLines = lines;

    // Check if first line is a line info comment
    if (lines[0]?.startsWith('// Lines ')) {
      actualLines = lines.slice(1);
    }

    // Sort operations by line number (descending) to avoid line number shifts
    const sortedOps = [...operations].sort((a, b) => {
      const aLine = a.line || a.range?.start || 0;
      const bLine = b.line || b.range?.start || 0;
      return bLine - aLine;
    });

    // Apply operations
    for (const op of sortedOps) {
      switch (op.type) {
        case 'insert':
          if (op.line !== undefined && op.content !== undefined) {
            actualLines.splice(op.line - 1, 0, op.content);
          }
          break;

        case 'replace':
          if (op.range && op.content !== undefined) {
            const deleteCount = op.range.end - op.range.start + 1;
            actualLines.splice(op.range.start - 1, deleteCount, op.content);
          }
          break;

        case 'delete':
          if (op.range) {
            const deleteCount = op.range.end - op.range.start + 1;
            actualLines.splice(op.range.start - 1, deleteCount);
          }
          break;
      }
    }

    // Update the file
    const newContent = actualLines.join('\n');
    await createOrUpdateFile(path, newContent, message, repository, branch);
  }

  /**
   * Insert text at a specific line
   */
  static async insertAtLine(
    path: string,
    repository: string,
    branch: string,
    line: number,
    content: string,
    message: string
  ): Promise<void> {
    await this.applyEdits({
      path,
      repository,
      branch,
      message,
      operations: [{ type: 'insert', line, content }],
    });
  }

  /**
   * Replace a range of lines
   */
  static async replaceLines(
    path: string,
    repository: string,
    branch: string,
    startLine: number,
    endLine: number,
    content: string,
    message: string
  ): Promise<void> {
    await this.applyEdits({
      path,
      repository,
      branch,
      message,
      operations: [
        {
          type: 'replace',
          range: { start: startLine, end: endLine },
          content,
        },
      ],
    });
  }

  /**
   * Delete a range of lines
   */
  static async deleteLines(
    path: string,
    repository: string,
    branch: string,
    startLine: number,
    endLine: number,
    message: string
  ): Promise<void> {
    await this.applyEdits({
      path,
      repository,
      branch,
      message,
      operations: [
        {
          type: 'delete',
          range: { start: startLine, end: endLine },
        },
      ],
    });
  }

  /**
   * Append content to the end of a file
   */
  static async appendToFile(
    path: string,
    repository: string,
    branch: string,
    content: string,
    message: string
  ): Promise<void> {
    // Get current file to determine line count
    const currentContent = await getFileContent(
      path,
      repository,
      1,
      10000,
      branch
    );
    const lines = currentContent.split('\n');

    // Remove line info header if present
    let actualLines = lines;
    if (lines[0]?.startsWith('// Lines ')) {
      actualLines = lines.slice(1);
    }

    const lineCount = actualLines.length;

    await this.insertAtLine(
      path,
      repository,
      branch,
      lineCount + 1,
      content,
      message
    );
  }

  /**
   * Prepend content to the beginning of a file
   */
  static async prependToFile(
    path: string,
    repository: string,
    branch: string,
    content: string,
    message: string
  ): Promise<void> {
    await this.insertAtLine(path, repository, branch, 1, content, message);
  }

  /**
   * Find and replace text in a file
   */
  static async findAndReplace(
    path: string,
    repository: string,
    branch: string,
    searchText: string,
    replaceText: string,
    message: string,
    options: {
      replaceAll?: boolean;
      caseSensitive?: boolean;
      wholeWord?: boolean;
    } = {}
  ): Promise<{ replacements: number }> {
    const {
      replaceAll = false,
      caseSensitive = true,
      wholeWord = false,
    } = options;

    // Get current file content
    const currentContent = await getFileContent(
      path,
      repository,
      1,
      10000,
      branch
    );
    const lines = currentContent.split('\n');

    // Remove line info header if present
    let actualLines = lines;
    if (lines[0]?.startsWith('// Lines ')) {
      actualLines = lines.slice(1);
    }

    let replacements = 0;
    const newLines = actualLines.map((line) => {
      let searchPattern = searchText;
      let flags = 'g';

      if (!caseSensitive) {
        flags += 'i';
      }

      if (wholeWord) {
        searchPattern = `\\b${searchText.replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&'
        )}\\b`;
      } else {
        searchPattern = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }

      const regex = new RegExp(searchPattern, flags);
      const matches = line.match(regex);

      if (matches) {
        replacements += matches.length;
        if (replaceAll) {
          return line.replace(regex, replaceText);
        } else {
          return line.replace(
            new RegExp(searchPattern, caseSensitive ? '' : 'i'),
            replaceText
          );
        }
      }

      return line;
    });

    if (replacements > 0) {
      const newContent = newLines.join('\n');
      await createOrUpdateFile(path, newContent, message, repository, branch);
    }

    return { replacements };
  }

  /**
   * Insert content after a specific pattern/line
   */
  static async insertAfterPattern(
    path: string,
    repository: string,
    branch: string,
    pattern: string,
    content: string,
    message: string,
    options: {
      caseSensitive?: boolean;
      wholeWord?: boolean;
    } = {}
  ): Promise<{ found: boolean; line?: number }> {
    const { caseSensitive = true, wholeWord = false } = options;

    // Get current file content
    const currentContent = await getFileContent(
      path,
      repository,
      1,
      10000,
      branch
    );
    const lines = currentContent.split('\n');

    // Remove line info header if present
    let actualLines = lines;
    if (lines[0]?.startsWith('// Lines ')) {
      actualLines = lines.slice(1);
    }

    let searchPattern = pattern;
    let flags = '';

    if (!caseSensitive) {
      flags += 'i';
    }

    if (wholeWord) {
      searchPattern = `\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`;
    } else {
      searchPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    const regex = new RegExp(searchPattern, flags);

    // Find the line with the pattern
    for (let i = 0; i < actualLines.length; i++) {
      if (regex.test(actualLines[i])) {
        await this.insertAtLine(
          path,
          repository,
          branch,
          i + 2,
          content,
          message
        );
        return { found: true, line: i + 1 };
      }
    }

    return { found: false };
  }

  /**
   * Insert content before a specific pattern/line
   */
  static async insertBeforePattern(
    path: string,
    repository: string,
    branch: string,
    pattern: string,
    content: string,
    message: string,
    options: {
      caseSensitive?: boolean;
      wholeWord?: boolean;
    } = {}
  ): Promise<{ found: boolean; line?: number }> {
    const { caseSensitive = true, wholeWord = false } = options;

    // Get current file content
    const currentContent = await getFileContent(
      path,
      repository,
      1,
      10000,
      branch
    );
    const lines = currentContent.split('\n');

    // Remove line info header if present
    let actualLines = lines;
    if (lines[0]?.startsWith('// Lines ')) {
      actualLines = lines.slice(1);
    }

    let searchPattern = pattern;
    let flags = '';

    if (!caseSensitive) {
      flags += 'i';
    }

    if (wholeWord) {
      searchPattern = `\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`;
    } else {
      searchPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    const regex = new RegExp(searchPattern, flags);

    // Find the line with the pattern
    for (let i = 0; i < actualLines.length; i++) {
      if (regex.test(actualLines[i])) {
        await this.insertAtLine(
          path,
          repository,
          branch,
          i + 1,
          content,
          message
        );
        return { found: true, line: i + 1 };
      }
    }

    return { found: false };
  }
}
