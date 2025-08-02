import { agentActivity } from './linear/linear-agent-session-manager.js';
import { extractLinearIssueFromBranch } from './tool-executors.js';

// Replace specific line ranges with new content
export const executeReplaceLines = async (
  {
    file_path,
    repository,
    branch,
    start_line,
    end_line,
    new_content,
    commit_message,
  }: {
    file_path: string;
    repository: string;
    branch: string;
    start_line: number;
    end_line: number;
    new_content: string;
    commit_message: string;
  },
  updateStatus?: (status: string) => void
) => {
  console.log('🔧 executeReplaceLines (line-based editing)');
  console.log('Parameters:', {
    file_path,
    repository,
    branch,
    start_line,
    end_line,
    new_content_length: new_content?.length,
    commit_message,
  });

  try {
    // PARAMETER VALIDATION
    if (!file_path) {
      return {
        success: false,
        error: 'file_path parameter is required',
        message: 'file_path parameter is required',
      };
    }
    if (!repository) {
      return {
        success: false,
        error: 'repository parameter is required',
        message: 'repository parameter is required',
      };
    }
    if (!commit_message) {
      return {
        success: false,
        error: 'commit_message parameter is required',
        message: 'commit_message parameter is required',
      };
    }
    if (start_line < 1) {
      return {
        success: false,
        error: 'start_line must be >= 1',
        message: 'start_line must be >= 1',
      };
    }
    if (end_line < start_line) {
      return {
        success: false,
        error: 'end_line must be >= start_line',
        message: 'end_line must be >= start_line',
      };
    }
    if (new_content === undefined) {
      new_content = ''; // Allow empty string for deletion
    }

    updateStatus?.(
      `Replacing lines ${start_line}-${end_line} in ${file_path}...`
    );

    // Extract Linear issue ID for logging
    const issueId = extractLinearIssueFromBranch(branch);
    if (issueId) {
      await agentActivity.thought(
        issueId,
        `Line-based edit: Replacing lines ${start_line}-${end_line} in ${file_path} (${repository}:${branch}). New content: ${new_content.length} characters.`
      );
    }

    // SAFETY CHECKS
    const lineCount = end_line - start_line + 1;
    if (lineCount > 100) {
      return {
        success: false,
        error: 'Cannot replace more than 100 lines at once',
        message: `Cannot replace more than 100 lines at once. You requested ${lineCount} lines.`,
      };
    }

    if (new_content.length > 10000) {
      return {
        success: false,
        error: 'New content too large',
        message: `New content too large (${new_content.length} characters). Maximum 10,000 characters allowed.`,
      };
    }

    // Get current file content
    const { getFileContent } = await import('./github/github-utils.js');
    const currentContent = await getFileContent(
      file_path,
      repository,
      1,
      10000,
      branch,
      undefined
    );

    // Remove header if present
    const lines = currentContent.split('\n');
    let content = currentContent;
    if (lines.length > 0 && lines[0]?.match(/^\/\/ Lines \d+-\d+ of \d+$/)) {
      content = lines.slice(1).join('\n');
    }

    const fileLines = content.split('\n');
    const totalLines = fileLines.length;

    // Validate line numbers
    if (start_line > totalLines) {
      return {
        success: false,
        error: 'start_line exceeds file length',
        message: `start_line ${start_line} exceeds file length (${totalLines} lines)`,
      };
    }
    if (end_line > totalLines) {
      return {
        success: false,
        error: 'end_line exceeds file length',
        message: `end_line ${end_line} exceeds file length (${totalLines} lines)`,
      };
    }

    // Perform line-based replacement
    const beforeLines = fileLines.slice(0, start_line - 1);
    const afterLines = fileLines.slice(end_line);
    const newLines = new_content ? new_content.split('\n') : [];

    const updatedLines = [...beforeLines, ...newLines, ...afterLines];
    const updatedContent = updatedLines.join('\n');

    // Update the file
    const { createOrUpdateFile } = await import('./github/github-utils.js');
    await createOrUpdateFile(
      file_path,
      updatedContent,
      commit_message,
      repository,
      branch
    );

    if (issueId) {
      await agentActivity.action(
        issueId,
        'Replaced lines',
        `${start_line}-${end_line} in ${file_path}`,
        `${lineCount} lines replaced with ${newLines.length} lines`
      );
    }

    console.log('✅ executeReplaceLines completed successfully');

    return {
      success: true,
      message: `Successfully replaced lines ${start_line}-${end_line} in ${file_path} (${lineCount} → ${newLines.length} lines)`,
      linesReplaced: lineCount,
      newLineCount: newLines.length,
    };
  } catch (error) {
    console.error('❌ Error in executeReplaceLines:', error);
    return error;
  }
};

// Insert new content at specific line numbers
export const executeInsertLines = async (
  {
    file_path,
    repository,
    branch,
    line_number,
    new_content,
    commit_message,
  }: {
    file_path: string;
    repository: string;
    branch: string;
    line_number: number;
    new_content: string;
    commit_message: string;
  },
  updateStatus?: (status: string) => void
) => {
  console.log('🔧 executeInsertLines (line-based insertion)');
  console.log('Parameters:', {
    file_path,
    repository,
    branch,
    line_number,
    new_content_length: new_content?.length,
    commit_message,
  });

  try {
    // PARAMETER VALIDATION
    if (!file_path) {
      return {
        success: false,
        error: 'file_path parameter is required',
        message: 'file_path parameter is required',
      };
    }
    if (!repository) {
      return {
        success: false,
        error: 'repository parameter is required',
        message: 'repository parameter is required',
      };
    }
    if (!commit_message) {
      return {
        success: false,
        error: 'commit_message parameter is required',
        message: 'commit_message parameter is required',
      };
    }
    if (line_number < 1) {
      return {
        success: false,
        error: 'line_number must be >= 1',
        message: 'line_number must be >= 1',
      };
    }
    if (new_content === undefined) {
      new_content = ''; // Allow empty string
    }

    updateStatus?.(
      `Inserting content at line ${line_number} in ${file_path}...`
    );

    // Extract Linear issue ID for logging
    const issueId = extractLinearIssueFromBranch(branch);
    if (issueId) {
      await agentActivity.thought(
        issueId,
        `➕ Line-based insert: Adding content at line ${line_number} in ${file_path} (${repository}:${branch}). Content: ${new_content.length} characters.`
      );
    }

    // SAFETY CHECKS
    if (new_content.length > 5000) {
      return {
        success: false,
        error: 'New content too large',
        message: `New content too large (${new_content.length} characters). Maximum 5,000 characters allowed.`,
      };
    }

    const newLines = new_content.split('\n');
    if (newLines.length > 50) {
      return {
        success: false,
        error: 'New content too large',
        message: `New content too large (${new_content.length} characters). Maximum 5,000 characters allowed.`,
      };
    }

    // Get current file content
    const { getFileContent } = await import('./github/github-utils.js');
    const currentContent = await getFileContent(
      file_path,
      repository,
      1,
      10000,
      branch,
      undefined
    );

    // Remove header if present
    const lines = currentContent.split('\n');
    let content = currentContent;
    if (lines.length > 0 && lines[0]?.match(/^\/\/ Lines \d+-\d+ of \d+$/)) {
      content = lines.slice(1).join('\n');
    }

    const fileLines = content.split('\n');
    const totalLines = fileLines.length;

    // Validate line number (allow inserting at end + 1)
    if (line_number > totalLines + 1) {
      return {
        success: false,
        error: 'line_number exceeds file length',
        message: `line_number ${line_number} exceeds file length (${totalLines} lines). Maximum allowed is ${
          totalLines + 1
        }.`,
      };
    }

    // Perform line-based insertion
    const beforeLines = fileLines.slice(0, line_number - 1);
    const afterLines = fileLines.slice(line_number - 1);
    const insertLines = new_content ? new_content.split('\n') : [];

    const updatedLines = [...beforeLines, ...insertLines, ...afterLines];
    const updatedContent = updatedLines.join('\n');

    // Update the file
    const { createOrUpdateFile } = await import('./github/github-utils.js');
    await createOrUpdateFile(
      file_path,
      updatedContent,
      commit_message,
      repository,
      branch
    );

    if (issueId) {
      await agentActivity.action(
        issueId,
        'Inserted lines',
        `${insertLines.length} lines at line ${line_number} in ${file_path}`,
        `Content inserted successfully`
      );
    }

    console.log('✅ executeInsertLines completed successfully');

    return {
      success: true,
      message: `Successfully inserted ${insertLines.length} lines at line ${line_number} in ${file_path}`,
      linesInserted: insertLines.length,
      insertedAtLine: line_number,
    };
  } catch (error) {
    console.error('❌ Error in executeInsertLines:', error);
    return error;
  }
};

// Delete specific line ranges
export const executeDeleteLines = async (
  {
    file_path,
    repository,
    branch,
    start_line,
    end_line,
    commit_message,
  }: {
    file_path: string;
    repository: string;
    branch: string;
    start_line: number;
    end_line: number;
    commit_message: string;
  },
  updateStatus?: (status: string) => void
) => {
  console.log('🔧 executeDeleteLines (line-based deletion)');
  console.log('Parameters:', {
    file_path,
    repository,
    branch,
    start_line,
    end_line,
    commit_message,
  });

  try {
    // PARAMETER VALIDATION
    if (!file_path) {
      return {
        success: false,
        error: 'file_path parameter is required',
        message: 'file_path parameter is required',
      };
    }
    if (!repository) {
      return {
        success: false,
        error: 'repository parameter is required',
        message: 'repository parameter is required',
      };
    }
    if (!commit_message) {
      return {
        success: false,
        error: 'commit_message parameter is required',
        message: 'commit_message parameter is required',
      };
    }
    if (start_line < 1) {
      return {
        success: false,
        error: 'start_line must be >= 1',
        message: 'start_line must be >= 1',
      };
    }
    if (end_line < start_line) {
      return {
        success: false,
        error: 'end_line must be >= start_line',
        message: 'end_line must be >= start_line',
      };
    }

    updateStatus?.(
      `Deleting lines ${start_line}-${end_line} in ${file_path}...`
    );

    // Extract Linear issue ID for logging
    const issueId = extractLinearIssueFromBranch(branch);
    if (issueId) {
      await agentActivity.thought(
        issueId,
        `🗑️ Line-based delete: Removing lines ${start_line}-${end_line} in ${file_path} (${repository}:${branch}).`
      );
    }

    // SAFETY CHECKS
    const lineCount = end_line - start_line + 1;
    if (lineCount > 50) {
      return {
        success: false,
        error: 'Cannot delete more than 50 lines at once',
        message: `Cannot delete more than 50 lines at once. You requested ${lineCount} lines.`,
      };
    }

    // Get current file content
    const { getFileContent } = await import('./github/github-utils.js');
    const currentContent = await getFileContent(
      file_path,
      repository,
      1,
      10000,
      branch,
      undefined
    );

    // Remove header if present
    const lines = currentContent.split('\n');
    let content = currentContent;
    if (lines.length > 0 && lines[0]?.match(/^\/\/ Lines \d+-\d+ of \d+$/)) {
      content = lines.slice(1).join('\n');
    }

    const fileLines = content.split('\n');
    const totalLines = fileLines.length;

    // Validate line numbers
    if (start_line > totalLines) {
      return {
        success: false,
        error: 'start_line exceeds file length',
        message: `start_line ${start_line} exceeds file length (${totalLines} lines)`,
      };
    }
    if (end_line > totalLines) {
      return {
        success: false,
        error: 'end_line exceeds file length',
        message: `end_line ${end_line} exceeds file length (${totalLines} lines)`,
      };
    }

    // Perform line-based deletion
    const beforeLines = fileLines.slice(0, start_line - 1);
    const afterLines = fileLines.slice(end_line);

    const updatedLines = [...beforeLines, ...afterLines];
    const updatedContent = updatedLines.join('\n');

    // Update the file
    const { createOrUpdateFile } = await import('./github/github-utils.js');
    await createOrUpdateFile(
      file_path,
      updatedContent,
      commit_message,
      repository,
      branch
    );

    if (issueId) {
      await agentActivity.action(
        issueId,
        'Deleted lines',
        `${start_line}-${end_line} in ${file_path}`,
        `${lineCount} lines deleted successfully`
      );
    }

    console.log('✅ executeDeleteLines completed successfully');

    return {
      success: true,
      message: `Successfully deleted lines ${start_line}-${end_line} in ${file_path} (${lineCount} lines removed)`,
      linesDeleted: lineCount,
      deletedRange: [start_line, end_line],
    };
  } catch (error) {
    console.error('❌ Error in executeDeleteLines:', error);
    return error;
  }
};
