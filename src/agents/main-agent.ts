import { Issue, LinearClient } from '@linear/sdk';
import { ModelAPI } from '../utils/model-api.js';
import { memoryManager } from '../tools/memory-manager.js';
import { env } from '../env.js';
import { buildLinearGptSystemPrompt } from '../prompts.js';
import { getToolDefinitions } from '../tools/index.js';

/**
 * Main orchestrator agent that coordinates sub-agents using Claude
 */
export class MainAgent {
  private modelAPI: ModelAPI;
  private _currentIssueId: string | null = null;

  constructor(private linearClient: LinearClient) {
    this.modelAPI = new ModelAPI();
  }

  /**
   * Process a notification with the main agent using Claude
   */
  async processNotification(context: {
    issue: Issue;
    notificationType?: string;
    commentId?: string;
    appUserId?: string;
  }): Promise<void> {
    try {
      const { issue, notificationType, commentId } = context;

      // Store the current issue ID
      this._currentIssueId = issue.id;

      // Get full issue context for the model
      const issueContext = await this.getIssueContext(issue, commentId);

      // Get previous conversations and actions from memory
      const previousConversations =
        await memoryManager.getPreviousConversations(issue.id);
      const issueHistory = await memoryManager.getIssueHistory(issue.id);

      // Define the tools available to the main agent
      const mainAgentTools = this.getMainAgentTools();

      // Create system message with context
      const systemMessage = buildLinearGptSystemPrompt({
        notificationType,
        commentId,
        issueContext: issueContext + previousConversations + issueHistory,
        availableTools: this.getMainAgentToolsDescription(),
        allowedRepositories: [],
      }) as string;

      // Initialize message array with the user message
      let messages: any[] = [
        {
          role: 'user',
          content:
            'As the main orchestrator agent, please analyze this issue and respond appropriately. You can communicate directly using the postComment tool, or delegate to specialized agents.',
        },
      ];

      // Process with Claude API
      const processResult = await this.modelAPI.processWithTools(
        systemMessage,
        messages,
        mainAgentTools
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

      // Process tool calls from the main agent
      if (toolUseBlocks.length > 0) {
        await this.processToolCalls(
          toolUseBlocks,
          issue,
          notificationType,
          commentId
        );
      }

      console.log(`Main agent processed issue ${issue.identifier}`);
    } catch (error) {
      console.error(`Error in main agent:`, error);
    }
  }

  /**
   * Call a sub-agent by making a request to its API endpoint
   */
  private async callSubAgent(
    agentType: string,
    context: {
      issue: Issue;
      notificationType?: string;
      commentId?: string;
      taskDescription: string;
    }
  ): Promise<void> {
    // Call the sub-agent's API endpoint
    const baseUrl = env.VERCEL_URL.startsWith('http')
      ? env.VERCEL_URL
      : `https://${env.VERCEL_URL}`;

    const endpointUrl = new URL(`/api/agents/${agentType}`, baseUrl);

    try {
      const response = await fetch(endpointUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': env.INTERNAL_API_TOKEN,
        },
        body: JSON.stringify(context),
      });

      if (!response.ok) {
        throw new Error(`Agent API returned status ${response.status}`);
      }

      // Track the delegation with the new method
      await memoryManager.trackAgentDelegation(
        context.issue.id,
        this._currentIssueId || context.issue.id, // Use current ID as main agent ID
        agentType,
        context.taskDescription
      );
    } catch (error) {
      console.error(`Error delegating to ${agentType} agent:`, error);

      // Post a comment about the error
      await this.linearClient.createComment({
        issueId: context.issue.id,
        body: `I tried to delegate to our ${agentType} specialist agent with task: "${context.taskDescription}", but encountered an error.`,
      });
    }
  }

  /**
   * Get the tools that are available to the main agent
   */
  private getMainAgentTools(): any[] {
    // Get only the main agent tools from the centralized tools definition
    const mainAgentToolNames = ['devAgent', 'linearAgent', 'createComment'];
    const allTools = getToolDefinitions();

    // Convert from the tools index format to the Claude API format
    return allTools.filter((tool) => mainAgentToolNames.includes(tool.name));
  }

  /**
   * Get a description of the tools available to the main agent
   */
  private getMainAgentToolsDescription(): string {
    return `
As the main agent, you have access to these tools:

1. devAgent: Delegate technical tasks to the specialized software engineer agent that can research code, implement changes, and manage GitHub operations.
   - Use this for: code implementation, bug fixes, feature development, technical research

2. linearAgent: Delegate product management tasks to the specialized agent that handles Linear issue management.
   - Use this for: issue organization, roadmap planning, progress tracking, product requirements

3. createComment: Create a comment on a Linear issue.
   - Use this for: providing status updates, asking clarifying questions, and communicating with users
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

  /**
   * Process tool calls from the main agent
   */
  private async processToolCalls(
    toolCalls: any[],
    issue: Issue,
    notificationType?: string,
    commentId?: string
  ): Promise<void> {
    for (const toolCall of toolCalls) {
      const toolName = toolCall.name;
      const toolInput = toolCall.input;

      if (toolName === 'devAgent' || toolName === 'linearAgent') {
        await this.callSubAgent(toolName === 'devAgent' ? 'dev' : 'linear', {
          issue,
          notificationType,
          commentId,
          taskDescription: toolInput.task,
        });
      } else if (toolName === 'createComment') {
        await this.postComment(
          toolInput.issueId || issue.id,
          toolInput.comment,
          toolInput.parentCommentId
        );
      }
    }
  }

  /**
   * Post a comment on a Linear issue
   */
  private async postComment(
    issueId: string,
    comment: string,
    parentCommentId?: string
  ): Promise<void> {
    try {
      await this.linearClient.createComment({
        issueId,
        body: comment,
        parentId: parentCommentId,
      });

      console.log(`Successfully posted comment on issue ${issueId}`);

      // Track the comment in memory
      await memoryManager.storeMemory(issueId, 'action', {
        type: 'comment',
        content: comment,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`Error posting comment on issue ${issueId}:`, error);
    }
  }
}
