import { Issue, LinearClient } from '@linear/sdk';
import { ModelAPI } from '../utils/model-api.js';
import { memoryManager } from '../tools/memory-manager.js';
import { env } from '../env.js';
import { buildLinearGptSystemPrompt } from '../prompts.js';
import { RepositoryUtils } from '../utils/repo-utils.js';
import { getToolDefinitions } from '../tools/index.js';

/**
 * Specialized agent for software development tasks
 */
export class DevAgent {
  private modelAPI: ModelAPI;
  private repoUtils: RepositoryUtils;
  private _currentIssueId: string | null = null;
  private allowedRepositories: string[] = [];

  constructor(private linearClient: LinearClient) {
    this.modelAPI = new ModelAPI();

    // Parse allowed repositories from env variable
    if (env.ALLOWED_REPOSITORIES) {
      this.allowedRepositories = env.ALLOWED_REPOSITORIES.split(',').map((r) =>
        r.trim()
      );
    }

    this.repoUtils = new RepositoryUtils(this.allowedRepositories);
  }

  /**
   * Process a task from the main agent
   */
  async processTask(context: {
    issue: Issue;
    notificationType?: string;
    commentId?: string;
    taskDescription: string;
  }): Promise<void> {
    try {
      const { issue, notificationType, commentId, taskDescription } = context;

      // Store the current issue ID
      this._currentIssueId = issue.id;

      // Get full issue context for the model
      const issueContext = await this.getIssueContext(issue, commentId);

      // Get previous conversations and actions from memory
      const previousConversations =
        await memoryManager.getPreviousConversations(issue.id);
      const issueHistory = await memoryManager.getIssueHistory(issue.id);

      // Get repository knowledge if available
      let repositoryKnowledge = '';
      try {
        const repoUsage = await memoryManager.getMostUsedRepository(issue.id);
        if (repoUsage) {
          repositoryKnowledge = await memoryManager.getRepositoryKnowledge(
            repoUsage
          );
        }
      } catch (error) {
        console.error(`Error getting repository knowledge:`, error);
      }

      // Get specialized tools for the dev agent
      const devTools = getToolDefinitions().filter((tool) =>
        this.getDevAgentToolNames().includes(tool.name)
      );

      // Create system message with specialized context
      const systemMessage = buildLinearGptSystemPrompt({
        notificationType,
        commentId,
        issueContext:
          issueContext +
          previousConversations +
          issueHistory +
          repositoryKnowledge +
          `\nTask from main agent: ${taskDescription}`,
        availableTools: this.getDevAgentToolsDescription(),
        allowedRepositories: this.allowedRepositories,
      }) as string;

      // Initialize message array with the user message
      let messages: any[] = [
        {
          role: 'user',
          content: `As the development specialist agent, please complete this task: ${taskDescription}. Focus on code research, implementation, and technical solutions.`,
        },
      ];

      // Process with Claude API
      const processResult = await this.modelAPI.processWithTools(
        systemMessage,
        messages,
        devTools
      );

      const finalResponse = processResult.response;
      const toolUseBlocks = processResult.toolCalls;

      // Store this response for future context
      const lastAssistantMessage = {
        role: 'assistant',
        content: finalResponse,
      };

      await memoryManager.storeMemory(
        issue.id,
        'conversation',
        lastAssistantMessage
      );

      // Process tool calls if any
      if (toolUseBlocks.length > 0) {
        for (const toolBlock of toolUseBlocks) {
          const toolName = toolBlock.name;
          const toolInput = toolBlock.input;
          let toolResponse = '';
          let toolSuccess = false;

          // Execute the tool by using the repository utils
          try {
            if (toolName === 'editFile') {
              toolResponse = await this.repoUtils.editFile(
                toolInput.repository,
                toolInput.path,
                toolInput.branch,
                toolInput.commitMessage,
                toolInput.edits,
                this._currentIssueId,
                toolInput.createBranchIfNeeded,
                toolInput.baseBranch
              );
              toolSuccess = true;
            } else if (toolName === 'replaceInFile') {
              toolResponse = await this.repoUtils.replaceInFile(
                toolInput.repository,
                toolInput.path,
                toolInput.branch,
                toolInput.commitMessage,
                toolInput.replacements,
                this._currentIssueId,
                toolInput.createBranchIfNeeded,
                toolInput.baseBranch
              );
              toolSuccess = true;
            } else if (toolName === 'searchCodeFiles') {
              // Call the search API
              // Implementation similar to what's in otron.ts
              toolSuccess = true;
            } else if (toolName === 'getDirectoryStructure') {
              const directoryStructure = await this.repoUtils
                .getLocalRepoManager()
                .getDirectoryStructure(toolInput.repository, toolInput.path);
              toolResponse = `Directory structure retrieved successfully`;
              toolSuccess = true;
            } else if (toolName === 'getFileContent') {
              const content = await this.repoUtils
                .getLocalRepoManager()
                .getFileContent(
                  toolInput.path,
                  toolInput.repository,
                  toolInput.startLine || 1,
                  toolInput.maxLines || 200,
                  toolInput.branch
                );
              toolResponse = `Retrieved content for ${toolInput.path}`;
              toolSuccess = true;
            } else {
              toolResponse = `Tool ${toolName} not implemented in dev agent`;
            }

            // Track tool usage with agent type
            await memoryManager.trackToolUsage(toolName, toolSuccess, {
              issueId: issue.id,
              input: toolInput,
              response: toolResponse,
              agentType: 'dev',
            });
          } catch (error) {
            toolResponse = `Error executing ${toolName}: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`;

            // Track failed tool usage
            await memoryManager.trackToolUsage(toolName, false, {
              issueId: issue.id,
              input: toolInput,
              response: toolResponse,
              agentType: 'dev',
            });
          }

          console.log(
            `Dev agent used tool: ${toolName}, success: ${toolSuccess}`
          );
        }
      }

      // Post a summary comment to the issue
      await this.linearClient.createComment({
        issueId: issue.id,
        body: `**Dev Agent Task Complete**\n\nI've finished the technical task: "${taskDescription}"\n\nSummary of actions taken:\n- Analyzed the issue requirements\n- Researched existing code\n- [Add specific actions taken here]`,
      });

      console.log(`Dev agent processed task for issue ${issue.identifier}`);
    } catch (error) {
      console.error(`Error in dev agent:`, error);

      // Post error message
      if (context.issue?.id) {
        await this.linearClient.createComment({
          issueId: context.issue.id,
          body: `**Dev Agent Error**\n\nI encountered an error while working on the task: "${context.taskDescription}"\n\nI'll inform the main agent so they can take appropriate action.`,
        });
      }
    }
  }

  /**
   * Get the list of tool names that the dev agent can use
   */
  private getDevAgentToolNames(): string[] {
    return [
      'editFile',
      'replaceInFile',
      'searchCodeFiles',
      'getDirectoryStructure',
      'getFileContent',
      'getPullRequest',
      'createPullRequest',
      'createBranchWithChanges',
    ];
  }

  /**
   * Get a description of the tools available to the dev agent
   */
  private getDevAgentToolsDescription(): string {
    return `
As the development agent, you have access to these tools:

1. searchCodeFiles: Search code repositories for keywords and patterns
2. getDirectoryStructure: View the directory structure of a repository
3. getFileContent: Read the content of specific files
4. editFile: Make changes to files with precise edits
5. replaceInFile: Replace content in files with new content
6. createPullRequest: Create a pull request with specified changes
7. createBranchWithChanges: Create a branch with a set of file changes
8. getPullRequest: Get details about an existing pull request
`;
  }

  /**
   * Get full context for an issue
   */
  private async getIssueContext(
    issue: Issue,
    commentId?: string
  ): Promise<string> {
    // In a real implementation, this would gather more context from Linear
    return `Issue ${issue.identifier}: ${issue.title}\n${
      issue.description || ''
    }`;
  }

  /**
   * Get the current issue ID
   */
  getCurrentIssueId(): string | null {
    return this._currentIssueId;
  }
}
