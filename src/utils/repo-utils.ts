import { LocalRepositoryManager } from '../tools/repository-manager.js';
import { memoryManager } from '../tools/memory-manager.js';

export class RepositoryUtils {
  private localRepoManager: LocalRepositoryManager;

  constructor(private allowedRepositories: string[]) {
    this.localRepoManager = new LocalRepositoryManager(allowedRepositories);
  }

  /**
   * Check if a branch is protected (main or master) and should not be directly modified
   * @param branch Branch name to check
   * @returns Object with isProtected flag and optional error message
   */
  isProtectedBranch(branch: string): {
    isProtected: boolean;
    errorMessage?: string;
  } {
    const protectedBranches = ['main', 'master'];

    if (protectedBranches.includes(branch.toLowerCase())) {
      return {
        isProtected: true,
        errorMessage: `Error: Cannot commit directly to ${branch}. Please use a feature branch instead.`,
      };
    }

    return { isProtected: false };
  }

  async editFile(
    repository: string,
    path: string,
    branch: string,
    commitMessage: string,
    edits: any[],
    issueId: string | null,
    createBranchIfNeeded: boolean = true,
    baseBranch: string = 'main'
  ): Promise<string> {
    try {
      // Check if branch is protected
      const branchCheck = this.isProtectedBranch(branch);
      if (branchCheck.isProtected) {
        return branchCheck.errorMessage as string;
      }

      // Create branch if needed
      if (createBranchIfNeeded) {
        try {
          await this.localRepoManager.createBranch(
            branch,
            repository,
            baseBranch
          );
          console.log(`Created new branch ${branch} in ${repository}`);
        } catch (error: any) {
          // Branch might already exist, which is fine
          console.log(
            `Note: Branch ${branch} may already exist: ${error.message}`
          );
        }
      }

      // Get the current file content
      const fileContentResult = await this.localRepoManager.getFileContent(
        path,
        repository,
        1, // startLine
        10000, // maxLines - large number to get entire file
        branch // Use the specified branch
      );

      // Split content into lines for processing
      let contentLines = fileContentResult.split('\n');
      const totalLines = contentLines.length;

      console.log(`File ${path} has ${totalLines} lines`);

      // Apply each edit in order
      for (const edit of edits) {
        const { type, startLine, endLine, content } = edit;

        // Validate line numbers
        if (startLine < 1 || startLine > totalLines + 1) {
          throw new Error(
            `Invalid startLine: ${startLine}. File has ${totalLines} lines.`
          );
        }

        // For operations that use endLine, validate it
        if (['delete', 'replace', 'update'].includes(type) && endLine) {
          if (endLine < startLine || endLine > totalLines) {
            throw new Error(
              `Invalid endLine: ${endLine}. File has ${totalLines} lines.`
            );
          }
        }

        // Apply the appropriate edit operation
        switch (type) {
          case 'insert':
            // Insert content at startLine (1-based index)
            const insertIdx = startLine - 1;
            const newContentLines = content.split('\n');
            contentLines.splice(insertIdx, 0, ...newContentLines);
            console.log(
              `Inserted ${newContentLines.length} lines at line ${startLine}`
            );
            break;

          case 'delete':
            // Delete lines from startLine to endLine inclusive
            const deleteCount = (endLine || startLine) - startLine + 1;
            contentLines.splice(startLine - 1, deleteCount);
            console.log(
              `Deleted ${deleteCount} lines starting at line ${startLine}`
            );
            break;

          case 'replace':
            // Replace lines from startLine to endLine with new content
            const replaceCount = (endLine || startLine) - startLine + 1;
            const replaceContentLines = content.split('\n');
            contentLines.splice(
              startLine - 1,
              replaceCount,
              ...replaceContentLines
            );
            console.log(
              `Replaced ${replaceCount} lines with ${replaceContentLines.length} lines starting at line ${startLine}`
            );
            break;

          case 'update':
            // Update specific lines while keeping the original line count
            // This is similar to replace but ensures the same number of lines
            const updateStart = startLine - 1;
            const updateEnd = endLine ? endLine - 1 : updateStart;
            const updateCount = updateEnd - updateStart + 1;
            const updateContentLines = content.split('\n');

            // Check if we're trying to update with a different number of lines
            if (updateContentLines.length !== updateCount) {
              console.log(
                `Warning: Update operation provided ${updateContentLines.length} lines but is replacing ${updateCount} lines. This might result in unexpected behavior.`
              );
            }

            contentLines.splice(
              updateStart,
              updateCount,
              ...updateContentLines
            );
            console.log(
              `Updated ${updateCount} lines starting at line ${startLine}`
            );
            break;

          default:
            throw new Error(`Unknown edit type: ${type}`);
        }
      }

      // Join the lines back together
      const newContent = contentLines.join('\n');

      // Update the file in the repository
      await this.localRepoManager.createOrUpdateFile(
        path,
        newContent,
        commitMessage,
        repository,
        branch
      );

      // Store relationship between issue and branch, assuming this is called in an issue context
      if (edits.length > 0 && issueId) {
        await memoryManager.storeRelationship(
          'issue:branch',
          issueId,
          `${repository}:${branch}`
        );
      }

      return `Successfully applied ${edits.length} edits to ${path} on branch ${branch} in ${repository}`;
    } catch (error) {
      console.error(`Error editing file ${path}:`, error);
      return `Error editing file: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
    }
  }

  async replaceInFile(
    repository: string,
    path: string,
    branch: string,
    commitMessage: string,
    replacements: any[],
    issueId: string | null,
    createBranchIfNeeded: boolean = true,
    baseBranch: string = 'main'
  ): Promise<string> {
    try {
      // Check if branch is protected
      const branchCheck = this.isProtectedBranch(branch);
      if (branchCheck.isProtected) {
        return branchCheck.errorMessage as string;
      }

      // Create branch if needed
      if (createBranchIfNeeded) {
        try {
          await this.localRepoManager.createBranch(
            branch,
            repository,
            baseBranch
          );
          console.log(`Created new branch ${branch} in ${repository}`);
        } catch (error: any) {
          // Branch might already exist, which is fine
          console.log(
            `Note: Branch ${branch} may already exist: ${error.message}`
          );
        }
      }

      // Get the current file content
      const fileContentResult = await this.localRepoManager.getFileContent(
        path,
        repository,
        1, // startLine
        10000, // maxLines - large number to get entire file
        branch // Use the specified branch
      );

      // Apply each replacement in order
      let fileContent = fileContentResult;
      let changesCount = 0;

      for (const replacement of replacements) {
        const { find, replace, regex = false, global = true } = replacement;

        if (regex) {
          // Handle regex replacement
          try {
            // Create flags for regex (global and case-sensitive by default)
            const flags = global ? 'g' : '';
            const pattern = new RegExp(find, flags);

            // Count occurrences before replacement
            const occurrences = (fileContent.match(pattern) || []).length;

            // Perform the replacement
            fileContent = fileContent.replace(pattern, replace);

            changesCount += occurrences;
            console.log(
              `Replaced ${occurrences} occurrences using regex pattern: ${find}`
            );
          } catch (regexError) {
            console.error(`Invalid regex pattern: ${find}`, regexError);
            return `Error: Invalid regex pattern '${find}': ${
              regexError instanceof Error ? regexError.message : 'Unknown error'
            }`;
          }
        } else {
          // Handle literal string replacement
          if (global) {
            // Count occurrences before replacement
            let count = 0;
            let tempContent = fileContent;
            let index = tempContent.indexOf(find);

            while (index !== -1) {
              count++;
              tempContent = tempContent.substring(index + find.length);
              index = tempContent.indexOf(find);
            }

            // Perform global replacement
            fileContent = fileContent.split(find).join(replace);
            changesCount += count;
            console.log(
              `Replaced ${count} occurrences of literal string: ${find}`
            );
          } else {
            // Replace only the first occurrence
            const index = fileContent.indexOf(find);
            if (index !== -1) {
              fileContent =
                fileContent.substring(0, index) +
                replace +
                fileContent.substring(index + find.length);
              changesCount++;
              console.log(
                `Replaced first occurrence of literal string: ${find}`
              );
            }
          }
        }
      }

      // Only update if changes were made
      if (changesCount > 0) {
        // Update the file in the repository
        await this.localRepoManager.createOrUpdateFile(
          path,
          fileContent,
          commitMessage,
          repository,
          branch
        );

        // Store relationship between issue and branch, assuming this is called in an issue context
        if (issueId) {
          await memoryManager.storeRelationship(
            'issue:branch',
            issueId,
            `${repository}:${branch}`
          );
        }

        return `Successfully made ${changesCount} replacements in ${path} on branch ${branch} in ${repository}`;
      } else {
        return `No changes were made to ${path}. The patterns specified were not found.`;
      }
    } catch (error) {
      console.error(`Error replacing text in file ${path}:`, error);
      return `Error replacing text in file: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
    }
  }

  getLocalRepoManager(): LocalRepositoryManager {
    return this.localRepoManager;
  }
}
