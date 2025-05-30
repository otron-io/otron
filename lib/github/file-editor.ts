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
    console.log('🔧 FileEditor.applyEdits CALLED');
    console.log('Edit parameters:', {
      path: edit.path,
      repository: edit.repository,
      branch: edit.branch,
      operationsCount: edit.operations.length,
      message: edit.message,
    });

    const { path, repository, branch, operations, message } = edit;

    try {
      console.log('📖 Getting current file content...');
      // Get current file content
      const currentContent = await getFileContent(
        path,
        repository,
        1,
        10000,
        branch
      );
      console.log('✅ Got file content, length:', currentContent.length);

      // Remove the line info header if present
      const lines = currentContent.split('\n');
      let actualLines = lines;

      // Check if first line is a line info comment
      if (lines[0]?.startsWith('// Lines ')) {
        actualLines = lines.slice(1);
        console.log('📝 Removed line info header');
      }

      console.log('📊 File has', actualLines.length, 'lines');

      // Sort operations by line number (descending) to avoid line number shifts
      const sortedOps = [...operations].sort((a, b) => {
        const aLine = a.line || a.range?.start || 0;
        const bLine = b.line || b.range?.start || 0;
        return bLine - aLine;
      });

      console.log(
        '🔄 Sorted operations:',
        sortedOps.map((op) => ({
          type: op.type,
          line: op.line,
          range: op.range,
          contentLength: op.content?.length,
        }))
      );

      // Apply operations
      for (const [index, op] of sortedOps.entries()) {
        console.log(`🔧 Applying operation ${index + 1}/${sortedOps.length}:`, {
          type: op.type,
          line: op.line,
          range: op.range,
        });

        switch (op.type) {
          case 'insert':
            if (op.line !== undefined && op.content !== undefined) {
              actualLines.splice(op.line - 1, 0, op.content);
              console.log(`✅ Inserted at line ${op.line}`);
            }
            break;

          case 'replace':
            if (op.range && op.content !== undefined) {
              const deleteCount = op.range.end - op.range.start + 1;
              actualLines.splice(op.range.start - 1, deleteCount, op.content);
              console.log(
                `✅ Replaced lines ${op.range.start}-${op.range.end}`
              );
            }
            break;

          case 'delete':
            if (op.range) {
              const deleteCount = op.range.end - op.range.start + 1;
              actualLines.splice(op.range.start - 1, deleteCount);
              console.log(`✅ Deleted lines ${op.range.start}-${op.range.end}`);
            }
            break;
        }
      }

      console.log(
        '📝 All operations applied, new file has',
        actualLines.length,
        'lines'
      );

      // Update the file
      const newContent = actualLines.join('\n');
      console.log('💾 Updating file with new content...');

      await createOrUpdateFile(path, newContent, message, repository, branch);
      console.log('✅ File updated successfully');
    } catch (error) {
      console.error('❌ Error in FileEditor.applyEdits:', error);
      throw error;
    }
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
    console.log('🔧 FileEditor.insertAtLine CALLED');
    console.log('Parameters:', {
      path,
      repository,
      branch,
      line,
      contentLength: content.length,
      message,
    });

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
    console.log('🔧 FileEditor.replaceLines CALLED');
    console.log('Parameters:', {
      path,
      repository,
      branch,
      startLine,
      endLine,
      contentLength: content.length,
      message,
    });

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
    console.log('🔧 FileEditor.deleteLines CALLED');
    console.log('Parameters:', {
      path,
      repository,
      branch,
      startLine,
      endLine,
      message,
    });

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
    console.log('🔧 FileEditor.appendToFile CALLED');
    console.log('Parameters:', {
      path,
      repository,
      branch,
      contentLength: content.length,
      message,
    });

    try {
      // Get current file to determine line count
      console.log('📖 Getting current file to determine line count...');
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
      console.log(
        '📊 Current file has',
        lineCount,
        'lines, appending at line',
        lineCount + 1
      );

      await this.insertAtLine(
        path,
        repository,
        branch,
        lineCount + 1,
        content,
        message
      );
    } catch (error) {
      console.error('❌ Error in FileEditor.appendToFile:', error);
      throw error;
    }
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
    console.log('🔧 FileEditor.prependToFile CALLED');
    console.log('Parameters:', {
      path,
      repository,
      branch,
      contentLength: content.length,
      message,
    });

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
