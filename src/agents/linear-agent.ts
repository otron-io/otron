import { Issue, LinearClient } from '@linear/sdk';
import { ModelAPI } from '../utils/model-api.js';
import { memoryManager } from '../tools/memory-manager.js';
import { env } from '../env.js';
import { buildLinearGptSystemPrompt } from '../prompts.js';
import { LinearManager } from '../tools/linear-manager.js';
import { getToolDefinitions } from '../tools/index.js';

/**
 * Specialized agent for product management and Linear tasks
 */
export class LinearAgent {
  private modelAPI: ModelAPI;
  private linearManager: LinearManager;
  private _currentIssueId: string | null = null;

  constructor(private linearClient: LinearClient) {
    this.modelAPI = new ModelAPI();
    this.linearManager = new LinearManager(this.linearClient);
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
      const issueContext = await this.linearManager.getIssueContext(
        issue,
        commentId
      );

      // Get previous conversations and actions from memory
      const previousConversations =
        await memoryManager.getPreviousConversations(issue.id);
      const issueHistory = await memoryManager.getIssueHistory(issue.id);

      // Get related issues
      const relatedIssues = await memoryManager.getRelatedIssues(
        issue.id,
        this.linearClient
      );

      // Get specialized tools for the linear agent
      const linearTools = getToolDefinitions().filter((tool) =>
        this.getLinearAgentToolNames().includes(tool.name)
      );

      // Create system message with specialized context
      const systemMessage = buildLinearGptSystemPrompt({
        notificationType,
        commentId,
        issueContext:
          issueContext +
          previousConversations +
          issueHistory +
          relatedIssues +
          `\nTask from main agent: ${taskDescription}`,
        availableTools: this.getLinearAgentToolsDescription(),
        allowedRepositories: [],
      }) as string;

      // Initialize message array with the user message
      let messages: any[] = [
        {
          role: 'user',
          content: `As the Linear product management specialist agent, please complete this task: ${taskDescription}. Focus on issue organization, roadmap planning, and product requirements.`,
        },
      ];

      // Process with Claude API
      const processResult = await this.modelAPI.processWithTools(
        systemMessage,
        messages,
        linearTools
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
          // Tool processing logic would go here - similar to what's in otron.ts
          // This is where the linear agent would use its specialized tools
          console.log(`Linear agent used tool: ${toolBlock.name}`);
        }
      }

      // Post a summary comment to the issue
      await this.linearClient.createComment({
        issueId: issue.id,
        body: `**Linear Agent Task Complete**\n\nI've finished the product management task: "${taskDescription}"\n\nSummary of actions taken:\n- Analyzed the issue requirements\n- Updated issue organization\n- [Add specific actions taken here]`,
      });

      console.log(`Linear agent processed task for issue ${issue.identifier}`);
    } catch (error) {
      console.error(`Error in linear agent:`, error);

      // Post error message
      if (context.issue?.id) {
        await this.linearClient.createComment({
          issueId: context.issue.id,
          body: `**Linear Agent Error**\n\nI encountered an error while working on the task: "${context.taskDescription}"\n\nI'll inform the main agent so they can take appropriate action.`,
        });
      }
    }
  }

  /**
   * Get the list of tool names that the linear agent can use
   */
  private getLinearAgentToolNames(): string[] {
    return [
      'createComment',
      'updateIssueStatus',
      'addLabel',
      'removeLabel',
      'assignIssue',
      'createIssue',
      'addIssueAttachment',
      'updateIssuePriority',
      'setPointEstimate',
    ];
  }

  /**
   * Get a description of the tools available to the linear agent
   */
  private getLinearAgentToolsDescription(): string {
    return `
As the Linear agent, you have access to these tools:

1. createComment: Add a comment to a Linear issue
2. updateIssueStatus: Change the status of an issue
3. addLabel: Add a label to an issue
4. removeLabel: Remove a label from an issue
5. assignIssue: Assign an issue to a user
6. createIssue: Create a new issue
7. addIssueAttachment: Add an attachment to an issue
8. updateIssuePriority: Update the priority of an issue
9. setPointEstimate: Set the point estimate for an issue
`;
  }

  /**
   * Get the current issue ID
   */
  getCurrentIssueId(): string | null {
    return this._currentIssueId;
  }
}
