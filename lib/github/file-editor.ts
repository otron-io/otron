import { getFileContent, createOrUpdateFile } from './github-utils.js';
import { GitHubAppService } from './github-app.js';

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
 * Get the complete raw file content without any headers or line limits
 */
const getRawFileContent = async (
  path: string,
  repository: string,
  branch: string
): Promise<string> => {
  console.log('📖 Getting complete raw file content...');

  try {
    // Get GitHub App service and Octokit client
    const githubAppService = GitHubAppService.getInstance();
    const octokit = await githubAppService.getOctokitForRepo(repository);
    const [owner, repo] = repository.split('/');

    console.log(
      `🔍 Fetching raw content for ${path} from ${repository}${
        branch ? ` (branch: ${branch})` : ''
      }`
    );

    // Get file content directly from GitHub API without any processing
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });

    if (!('content' in data) || typeof data.content !== 'string') {
      throw new Error(`Unexpected response format for ${path}`);
    }

    // Decode base64 content to get the raw file content
    const rawContent = Buffer.from(data.content, 'base64').toString('utf-8');

    console.log('✅ Got complete raw file content, length:', rawContent.length);
    console.log('📊 File has', rawContent.split('\n').length, 'lines');

    return rawContent;
  } catch (error: any) {
    console.error(`❌ Error getting raw file content for ${path}:`, error);

    // Fallback to the getFileContent function if direct API access fails
    console.log('🔄 Falling back to getFileContent...');

    const contentWithHeader = await getFileContent(
      path,
      repository,
      1,
      10000, // Large number to get most/all of the file
      branch
    );

    const lines = contentWithHeader.split('\n');

    // Check if first line is the line info header from getFileContent
    if (lines.length > 0 && lines[0]?.match(/^\/\/ Lines \d+-\d+ of \d+$/)) {
      const rawContent = lines.slice(1).join('\n');
      console.log(
        '✅ Removed line info header from fallback, raw content length:',
        rawContent.length
      );
      return rawContent;
    }

    // If no header detected, return as-is
    console.log(
      'ℹ️ No line info header detected in fallback, using content as-is'
    );
    return contentWithHeader;
  }
};

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
      // Get raw file content without any headers
      const currentContent = await getRawFileContent(path, repository, branch);

      // Split into lines
      const lines = currentContent.split('\n');
      console.log('📊 File has', lines.length, 'lines');

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

      // Apply operations to a copy of the lines
      let modifiedLines = [...lines];

      for (const [index, op] of sortedOps.entries()) {
        console.log(`🔧 Applying operation ${index + 1}/${sortedOps.length}:`, {
          type: op.type,
          line: op.line,
          range: op.range,
        });

        switch (op.type) {
          case 'insert':
            if (op.line !== undefined && op.content !== undefined) {
              // Insert at the specified line (1-based indexing)
              const insertIndex = op.line - 1;
              modifiedLines.splice(insertIndex, 0, op.content);
              console.log(
                `✅ Inserted at line ${op.line} (index ${insertIndex})`
              );
            }
            break;

          case 'replace':
            if (op.range && op.content !== undefined) {
              // Replace the range of lines (1-based indexing)
              const startIndex = op.range.start - 1;
              const deleteCount = op.range.end - op.range.start + 1;
              modifiedLines.splice(startIndex, deleteCount, op.content);
              console.log(
                `✅ Replaced lines ${op.range.start}-${
                  op.range.end
                } (indices ${startIndex}-${startIndex + deleteCount - 1})`
              );
            }
            break;

          case 'delete':
            if (op.range) {
              // Delete the range of lines (1-based indexing)
              const startIndex = op.range.start - 1;
              const deleteCount = op.range.end - op.range.start + 1;
              modifiedLines.splice(startIndex, deleteCount);
              console.log(
                `✅ Deleted lines ${op.range.start}-${
                  op.range.end
                } (indices ${startIndex}-${startIndex + deleteCount - 1})`
              );
            }
            break;
        }

        console.log(
          `📊 After operation ${index + 1}, file has ${
            modifiedLines.length
          } lines`
        );
      }

      console.log(
        '📝 All operations applied, new file has',
        modifiedLines.length,
        'lines'
      );

      // Create the new content
      const newContent = modifiedLines.join('\n');
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
      // Get raw file content to determine line count
      console.log('📖 Getting raw file to determine line count...');
      const currentContent = await getRawFileContent(path, repository, branch);
      const lines = currentContent.split('\n');
      const lineCount = lines.length;

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

    console.log('🔧 FileEditor.findAndReplace CALLED');
    console.log('Parameters:', {
      path,
      repository,
      branch,
      searchText: searchText.substring(0, 50) + '...',
      replaceText: replaceText.substring(0, 50) + '...',
      options,
    });

    // Get raw file content
    const currentContent = await getRawFileContent(path, repository, branch);
    const lines = currentContent.split('\n');

    let replacements = 0;
    const newLines = lines.map((line) => {
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
      console.log(`✅ Made ${replacements} replacement(s)`);
    } else {
      console.log('ℹ️ No matches found for replacement');
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

    console.log('🔧 FileEditor.insertAfterPattern CALLED');
    console.log('Parameters:', {
      path,
      repository,
      branch,
      pattern: pattern.substring(0, 50) + '...',
      contentLength: content.length,
      options,
    });

    // Get raw file content
    const currentContent = await getRawFileContent(path, repository, branch);
    const lines = currentContent.split('\n');

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
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        console.log(`✅ Found pattern at line ${i + 1}, inserting after it`);
        await this.insertAtLine(
          path,
          repository,
          branch,
          i + 2, // Insert after this line
          content,
          message
        );
        return { found: true, line: i + 1 };
      }
    }

    console.log('ℹ️ Pattern not found');
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

    console.log('🔧 FileEditor.insertBeforePattern CALLED');
    console.log('Parameters:', {
      path,
      repository,
      branch,
      pattern: pattern.substring(0, 50) + '...',
      contentLength: content.length,
      options,
    });

    // Get raw file content
    const currentContent = await getRawFileContent(path, repository, branch);
    const lines = currentContent.split('\n');

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
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        console.log(`✅ Found pattern at line ${i + 1}, inserting before it`);
        await this.insertAtLine(
          path,
          repository,
          branch,
          i + 1, // Insert before this line
          content,
          message
        );
        return { found: true, line: i + 1 };
      }
    }

    console.log('ℹ️ Pattern not found');
    return { found: false };
  }
}
