import { CoreMessage, generateText, tool } from 'ai';
import { z } from 'zod';
import {
  // General tools
  executeSearchWeb,
  // Linear tools
  executeGetIssueContext,
  executeUpdateIssueStatus,
  executeAddLabel,
  executeRemoveLabel,
  executeAssignIssue,
  executeCreateIssue,
  executeAddIssueAttachment,
  executeUpdateIssuePriority,
  executeSetPointEstimate,
  executeGetLinearTeams,
  executeGetLinearProjects,
  executeGetLinearInitiatives,
  executeGetLinearUsers,
  executeGetLinearRecentIssues,
  executeSearchLinearIssues,
  executeGetLinearWorkflowStates,
  executeCreateLinearComment,
  // GitHub tools
  executeGetFileContent,
  executeCreateBranch,
  executeCreateOrUpdateFile,
  executeCreatePullRequest,
  executeGetPullRequest,
  executeAddPullRequestComment,
  executeGetPullRequestFiles,
  executeGetDirectoryStructure,
  executeGetRepositoryStructure,
  // GitHub file editing tools
  executeInsertAtLine,
  executeReplaceLines,
  executeDeleteLines,
  executeAppendToFile,
  executePrependToFile,
  executeFindAndReplace,
  executeInsertAfterPattern,
  executeInsertBeforePattern,
  executeApplyMultipleEdits,
  // GitHub branch management tools
  executeResetBranchToHead,
  // GitHub file reading tools
  executeReadFileWithContext,
  executeAnalyzeFileStructure,
  executeReadRelatedFiles,
  // Embedded repository tools
  executeSearchEmbeddedCode,
  // Slack tools
  executeSendSlackMessage,
  executeSendDirectMessage,
  executeSendChannelMessage,
  executeAddSlackReaction,
  executeRemoveSlackReaction,
  executeGetSlackChannelHistory,
  executeGetSlackThread,
  executeUpdateSlackMessage,
  executeDeleteSlackMessage,
  executeGetSlackUserInfo,
  executeGetSlackChannelInfo,
  executeJoinSlackChannel,
  executeSearchSlackMessages,
  executeSetSlackStatus,
  executePinSlackMessage,
  executeUnpinSlackMessage,
  executeSendRichSlackMessage,
  executeSendRichChannelMessage,
  executeSendRichDirectMessage,
  executeCreateFormattedSlackMessage,
  executeRespondToSlackInteraction,
} from './tool-executors.js';
import { LinearClient } from '@linear/sdk';
import { memoryManager } from './memory/memory-manager.js';
import { goalEvaluator } from './goal-evaluator.js';
import { OpenAIProviderSettings, openai } from '@ai-sdk/openai';

// Helper function to extract issue ID from context
function extractIssueIdFromContext(
  messages: CoreMessage[],
  slackContext?: { channelId: string; threadTs?: string }
): string {
  // Try to extract issue ID from message content
  for (const message of messages) {
    if (typeof message.content === 'string') {
      // Look for Linear issue patterns like OTR-123, ABC-456, etc.
      const issueMatch = message.content.match(/\b([A-Z]{2,}-\d+)\b/);
      if (issueMatch) {
        return issueMatch[1];
      }

      // Look for issue ID in Linear notification context
      const issueIdMatch = message.content.match(/issue\s+([a-f0-9-]{36})/i);
      if (issueIdMatch) {
        return issueIdMatch[1];
      }
    }
  }

  // If no issue ID found in messages, use Slack context as fallback
  if (slackContext?.channelId) {
    return `slack:${slackContext.channelId}${
      slackContext.threadTs ? `:${slackContext.threadTs}` : ''
    }`;
  }

  // Default fallback
  return 'general';
}

export const generateResponse = async (
  messages: CoreMessage[],
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient,
  slackContext?: {
    channelId: string;
    threadTs?: string;
  }
): Promise<string> => {
  const MAX_RETRY_ATTEMPTS = 2;
  let attemptNumber = 1;
  let toolsUsed: string[] = [];
  let actionsPerformed: string[] = [];
  let finalResponse = '';
  let endedExplicitly = false;

  // Store original messages for evaluation
  const originalMessages = [...messages];

  while (attemptNumber <= MAX_RETRY_ATTEMPTS) {
    try {
      updateStatus?.(
        `is thinking... (Attempt ${attemptNumber}/${MAX_RETRY_ATTEMPTS})`
      );

      // Generate response using the internal function
      const result = await generateResponseInternal(
        messages,
        updateStatus,
        linearClient,
        slackContext,
        attemptNumber
      );

      finalResponse = result.text;
      toolsUsed = result.toolsUsed;
      actionsPerformed = result.actionsPerformed;
      endedExplicitly = result.endedExplicitly;

      // If this is the last attempt, don't evaluate - just return
      if (attemptNumber >= MAX_RETRY_ATTEMPTS) {
        return finalResponse;
      }

      // Evaluate goal completion
      updateStatus?.(
        `Evaluating goal completion for attempt ${attemptNumber}...`
      );

      const evaluation = await goalEvaluator.evaluateGoalCompletion(
        originalMessages,
        {
          toolsUsed,
          actionsPerformed,
          finalResponse,
          endedExplicitly,
        },
        attemptNumber
      );

      // If goal is complete and confidence is high enough, return the response
      if (evaluation.isComplete && evaluation.confidence >= 0.7) {
        console.log(
          `Goal evaluation passed on attempt ${attemptNumber}:`,
          evaluation.reasoning
        );
        return finalResponse;
      }

      // Goal not complete - prepare for retry
      console.log(
        `Goal evaluation failed on attempt ${attemptNumber}:`,
        evaluation.reasoning
      );

      // Generate retry feedback
      const retryFeedback = goalEvaluator.generateRetryFeedback(
        evaluation,
        attemptNumber
      );

      // Add the retry feedback as a new user message
      messages.push({
        role: 'user',
        content: retryFeedback,
      });

      attemptNumber++;
    } catch (error) {
      console.error(`Error in attempt ${attemptNumber}:`, error);

      // If this is the last attempt, throw the error
      if (attemptNumber >= MAX_RETRY_ATTEMPTS) {
        throw error;
      }

      // Otherwise, try again
      attemptNumber++;
    }
  }

  return finalResponse;
};

// Internal function that does the actual response generation
const generateResponseInternal = async (
  messages: CoreMessage[],
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient,
  slackContext?: {
    channelId: string;
    threadTs?: string;
  },
  attemptNumber: number = 1
): Promise<{
  text: string;
  toolsUsed: string[];
  actionsPerformed: string[];
  endedExplicitly: boolean;
}> => {
  // Track execution details for goal evaluation
  const executionTracker = {
    toolsUsed: new Set<string>(),
    actionsPerformed: [] as string[],
    endedExplicitly: false,
  };

  // Extract context ID for memory operations
  const contextId = extractIssueIdFromContext(messages, slackContext);

  // Store the incoming message in memory
  try {
    const lastMessage = messages[messages.length - 1];
    const messageContent =
      typeof lastMessage?.content === 'string'
        ? lastMessage.content
        : Array.isArray(lastMessage?.content)
        ? lastMessage.content
            .map((part) => ('text' in part ? part.text : JSON.stringify(part)))
            .join(' ')
        : 'No content';

    await memoryManager.storeMemory(contextId, 'conversation', {
      role: 'user',
      content: messageContent,
      timestamp: Date.now(),
      platform: slackContext ? 'slack' : 'linear',
      metadata: slackContext || {},
    });
  } catch (error) {
    console.error('Error storing user message in memory:', error);
  }

  // Retrieve memory context with smart relevance filtering
  let memoryContext = '';
  try {
    const lastMessage = messages[messages.length - 1];
    const currentMessageContent =
      typeof lastMessage?.content === 'string'
        ? lastMessage.content
        : Array.isArray(lastMessage?.content)
        ? lastMessage.content
            .map((part) => ('text' in part ? part.text : ''))
            .join(' ')
        : '';

    const previousConversations = await memoryManager.getPreviousConversations(
      contextId,
      currentMessageContent
    );
    const issueHistory = await memoryManager.getIssueHistory(contextId);

    memoryContext = previousConversations + issueHistory;
  } catch (error) {
    console.error('Error retrieving memory context:', error);
  }

  // Create enhanced system prompt with memory context
  const systemPrompt = `You are Otron. An omnipresent AI agent. You exist across Slack, Linear, and GitHub.
    - You keep your responses concise and to the point, but friendly and engaging while being as helpful as possible.
    - You can be notified to take action via all 3 platforms, and can take actions on all 3 platforms.
    - You have persistent memory across conversations and can remember previous interactions, actions, and context.
    
    CRITICAL: You must EXPLICITLY decide where and how to respond using your available tools.
    - When you receive a message from Slack, you are NOT automatically responding to Slack - you must use Slack tools to send messages if you want to respond there.
    - When you receive a Linear notification, you are NOT automatically commenting on Linear - you must use Linear tools to create comments if you want to respond there.
    - You have full control over whether to respond, where to respond, and what actions to take.
    - You can choose to respond on the same platform, a different platform, multiple platforms, or not respond at all.
    - Use the appropriate tools (sendSlackMessage, createIssue, addPullRequestComment, etc.) to take any actions you deem necessary.
    - While you are in charge of where and how to respond, you must still provide feedback to show you are aware. This can be as simple as a reaction to acknowledge the message. For example, if a user asks you to send a message elsewhere, you can send it and just respond to the original message with a reaction to acknowledge the message.

    MEMORY & CONTEXT AWARENESS:
    - You have access to previous conversations, actions, and related context through your persistent memory system.
    - Use this context to provide more informed and relevant responses.
    - Reference previous conversations when relevant to show continuity and understanding.
    - Learn from past actions and their outcomes to improve future responses.
    - Current context ID: ${contextId}

    ADVANCED FILE EDITING CAPABILITIES:
    - You have access to precise, targeted file editing tools that allow you to make specific changes without affecting the rest of the file.
    - ALWAYS prefer these targeted editing tools over createOrUpdateFile to avoid unintentional deletions:
      * insertAtLine: Insert content at a specific line number
      * replaceLines: Replace a specific range of lines (much safer than replacing entire files)
      * deleteLines: Delete a specific range of lines
      * appendToFile: Add content to the end of a file
      * prependToFile: Add content to the beginning of a file
      * findAndReplace: Find and replace text with options for case sensitivity and whole word matching
      * insertAfterPattern: Insert content after a line matching a pattern
      * insertBeforePattern: Insert content before a line matching a pattern
      * applyMultipleEdits: Apply multiple edit operations in a single commit (operations are applied in reverse line order to avoid conflicts)
    - These tools provide surgical precision for code changes and prevent accidental loss of existing content.
    - Use createOrUpdateFile only when creating entirely new files or when you need to replace the complete file content intentionally.

    SLACK FORMATTING & BLOCK KIT:
    - For simple text messages, use sendSlackMessage, sendChannelMessage, or sendDirectMessage
    - For rich, visually appealing messages, use sendRichSlackMessage, sendRichChannelMessage, or sendRichDirectMessage with Block Kit
    - Slack uses mrkdwn format: *bold*, _italic_, ~strikethrough~, \`code\`, \`\`\`code block\`\`\`, >quote, • bullet
    - Links: <https://example.com|Link Text> or just <https://example.com>
    - User mentions: <@U1234567> or <@U1234567|username>
    - Channel mentions: <#C1234567> or <#C1234567|channel-name>
    
    BLOCK KIT EXAMPLES:
    Use rich messages for:
    - Status updates with visual hierarchy
    - Data presentations (Linear issues, GitHub PRs)
    - Interactive content with buttons - you will be notified if a user clicks a button so you can respond to it
    - Multi-section content with dividers
    - Lists with proper formatting
    
    IMPORTANT: Every Block Kit block MUST have a "type" field as the first property.
    
    Common Block Kit patterns:
    1. Header: {"type": "header", "text": {"type": "plain_text", "text": "Title"}}
    2. Section with text: {"type": "section", "text": {"type": "mrkdwn", "text": "Content"}}
    3. Section with fields: {"type": "section", "fields": [{"type": "mrkdwn", "text": "*Field:*\\nValue"}]}
    4. Divider: {"type": "divider"}
    5. Context: {"type": "context", "elements": [{"type": "mrkdwn", "text": "Last updated: 2024-01-01"}]}
    6. Actions: {"type": "actions", "elements": [{"type": "button", "text": {"type": "plain_text", "text": "Click Me"}, "action_id": "button_click", "style": "primary"}]}

    WHEN TO USE RICH MESSAGES:
    - Linear issue summaries (use header + fields + context)
    - GitHub PR reviews (use sections + dividers + actions)
    - Status reports (use header + multiple sections)
    - Lists of items (use sections with bullet points)
    - Data tables (use fields in sections)
    - Interactive content (use actions with buttons)
    
    EXAMPLE RICH MESSAGE FOR LINEAR ISSUE:
    [
      {"type": "header", "text": {"type": "plain_text", "text": "🎯 Linear Issue Update"}},
      {"type": "section", "fields": [
        {"type": "mrkdwn", "text": "*Issue:*\\nOTR-123"},
        {"type": "mrkdwn", "text": "*Status:*\\nIn Progress"},
        {"type": "mrkdwn", "text": "*Assignee:*\\nJohn Doe"},
        {"type": "mrkdwn", "text": "*Priority:*\\nHigh"}
      ]},
      {"type": "divider"},
      {"type": "section", "text": {"type": "mrkdwn", "text": "*Description:*\\nImplement new feature for user authentication"}},
      {"type": "context", "elements": [{"type": "mrkdwn", "text": "Updated 2 hours ago"}]}
    ]

    LINEAR AND SOFTWARE ENGINEERING NOTES:
    - You are a software engineer. You work on issues and raise PRs to fix them and create new features.
    - When assigned to a linear issue, you must follow through and finish the issue.
    - Regardless of the outcome of your work, you must leave a comment on the linear issue with the outcome of your work, even if you could not complete the issue.
    - If someone is speaking to you in Slack and you start working on something, you must get back to them when you are done so they know what happened. 
    - If code search is resulting in no results, try other methods of finding the information you need and if you can't then inform the user either via Slack or Linear.
    - If you need help, you are more than encouraged to ask a user for help. Either via Slack or Linear. You must do this as soon as you realize you need help.
    - You do not need to excessively research the codebase when working on an issue. Understand what you need to and then use the editing tools to make the changes.

    GITHUB REPO NOTES:
    - Your repository is https://github.com/otron-io/otron, you can develop and improve yourself via this repository.
    - When making code changes, always use the most appropriate editing tool for the task:
      * For small insertions: use insertAtLine or insertAfterPattern/insertBeforePattern
      * For replacing specific sections: use replaceLines
      * For simple text replacements: use findAndReplace
      * For multiple related changes: use applyMultipleEdits to batch them into a single commit
      * For adding to files: use appendToFile or prependToFile
    - This approach ensures precise changes and prevents accidental deletion of existing code.

    IMPORTANT CONTEXT AWARENESS:
    - When users refer to "my message", "this message", "the message above", or similar contextual references, look at the message history to identify which specific message they're referring to.
    - User messages include metadata in the format: [Message from user {userId} at {timestamp}]: {content}
    - Use the timestamp and channel information to identify specific messages when users ask you to react, reply, or take action on them.
    - When a user asks you to react to a message, use the addSlackReaction tool with the appropriate channel and timestamp.
    - Pay attention to the chronological order of messages to understand context like "the message above" or "my previous message".
    ${
      slackContext
        ? `- Current Slack context: Channel ID: ${slackContext.channelId}${
            slackContext.threadTs ? `, Thread: ${slackContext.threadTs}` : ''
          }
    - When reacting to messages in the current conversation, use channel ID: ${
      slackContext.channelId
    }`
        : ''
    }

    ${memoryContext ? `MEMORY CONTEXT:\n${memoryContext}` : ''}

    Final notes:
    - Current date is: ${new Date().toISOString().split('T')[0]}
    - Make sure to ALWAYS include sources in your final response if you use web search. Put sources inline if possible.
    - Remember: You control all communication - use your tools to respond where and how you see fit.
    - Choose rich Block Kit messages when the content benefits from visual structure, formatting, or interactivity.
    - Use your memory context to provide more informed and continuous conversations.
    - ALWAYS use targeted file editing tools for precise code changes to avoid unintentional deletions.`;

  // Create a wrapper for tool execution that tracks usage in memory
  const createMemoryAwareToolExecutor = (
    toolName: string,
    originalExecutor: Function
  ) => {
    return async (...args: any[]) => {
      const startTime = Date.now();
      let success = false;
      let response = '';

      try {
        const result = await originalExecutor(...args);
        success = true;
        response = typeof result === 'string' ? result : JSON.stringify(result);

        // Track tool usage for goal evaluation
        executionTracker.toolsUsed.add(toolName);
        executionTracker.actionsPerformed.push(
          `${toolName}: ${response.substring(0, 100)}...`
        );

        // Check if this is an endActions call
        if (toolName === 'endActions') {
          executionTracker.endedExplicitly = true;
        }

        // Track tool usage in memory
        await memoryManager.trackToolUsage(toolName, success, {
          issueId: contextId,
          input: args,
          response: response.substring(0, 500), // Limit response length for storage
        });

        return result;
      } catch (error) {
        success = false;
        response = error instanceof Error ? error.message : String(error);

        // Track failed tool usage
        await memoryManager.trackToolUsage(toolName, success, {
          issueId: contextId,
          input: args,
          response,
        });

        return error;
      }
    };
  };

  const { text } = await generateText({
    model: openai.responses('o3'),
    system: systemPrompt,
    messages,
    maxSteps: 50,
    providerOptions: {
      openai: {
        reasoningEffort: 'high',
      },
    },
    tools: {
      // Disabled for now as they removed support for it
      // webSearch: openai.tools.webSearchPreview(),
      // Slack tools
      sendSlackMessage: tool({
        description: 'Send a message to a Slack channel or thread',
        parameters: z.object({
          channel: z.string().describe('The channel ID to send the message to'),
          text: z.string().describe('The message text to send'),
          threadTs: z
            .string()
            .describe(
              'Optional thread timestamp to reply in a thread. Leave empty if not replying to a thread.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'sendSlackMessage',
          (params: any) => executeSendSlackMessage(params, updateStatus)
        ),
      }),
      sendDirectMessage: tool({
        description: 'Send a direct message to a Slack user',
        parameters: z.object({
          userIdOrEmail: z
            .string()
            .describe('User ID or email address of the recipient'),
          text: z.string().describe('The message text to send'),
        }),
        execute: createMemoryAwareToolExecutor(
          'sendDirectMessage',
          (params: any) => executeSendDirectMessage(params, updateStatus)
        ),
      }),
      sendChannelMessage: tool({
        description: 'Send a message to a Slack channel by name or ID',
        parameters: z.object({
          channelNameOrId: z
            .string()
            .describe('Channel name (with or without #) or channel ID'),
          text: z.string().describe('The message text to send'),
          threadTs: z
            .string()
            .describe(
              'Optional thread timestamp to reply in a thread. Leave empty if not replying to a thread.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'sendChannelMessage',
          (params: any) => executeSendChannelMessage(params, updateStatus)
        ),
      }),
      addSlackReaction: tool({
        description: 'Add a reaction emoji to a Slack message',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          timestamp: z.string().describe('The message timestamp'),
          emoji: z
            .string()
            .describe('The emoji name (without colons, e.g., "thumbsup")'),
        }),
        execute: createMemoryAwareToolExecutor(
          'addSlackReaction',
          (params: any) => executeAddSlackReaction(params, updateStatus)
        ),
      }),
      removeSlackReaction: tool({
        description: 'Remove a reaction emoji from a Slack message',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          timestamp: z.string().describe('The message timestamp'),
          emoji: z
            .string()
            .describe('The emoji name (without colons, e.g., "thumbsup")'),
        }),
        execute: createMemoryAwareToolExecutor(
          'removeSlackReaction',
          (params: any) => executeRemoveSlackReaction(params, updateStatus)
        ),
      }),
      getSlackChannelHistory: tool({
        description: 'Get recent message history from a Slack channel',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          limit: z
            .number()
            .describe(
              'Number of messages to retrieve (default: 10). Use 10 if not specified.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'getSlackChannelHistory',
          (params: any) => executeGetSlackChannelHistory(params, updateStatus)
        ),
      }),
      getSlackThread: tool({
        description: 'Get all messages in a Slack thread',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          threadTs: z.string().describe('The thread timestamp'),
        }),
        execute: createMemoryAwareToolExecutor(
          'getSlackThread',
          (params: any) => executeGetSlackThread(params, updateStatus)
        ),
      }),
      updateSlackMessage: tool({
        description: 'Update an existing Slack message',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          timestamp: z.string().describe('The message timestamp'),
          text: z.string().describe('The new message text'),
        }),
        execute: createMemoryAwareToolExecutor(
          'updateSlackMessage',
          (params: any) => executeUpdateSlackMessage(params, updateStatus)
        ),
      }),
      deleteSlackMessage: tool({
        description: 'Delete a Slack message',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          timestamp: z.string().describe('The message timestamp'),
        }),
        execute: createMemoryAwareToolExecutor(
          'deleteSlackMessage',
          (params: any) => executeDeleteSlackMessage(params, updateStatus)
        ),
      }),
      getSlackUserInfo: tool({
        description: 'Get information about a Slack user',
        parameters: z.object({
          userIdOrEmail: z
            .string()
            .describe('User ID or email address to look up'),
        }),
        execute: createMemoryAwareToolExecutor(
          'getSlackUserInfo',
          (params: any) => executeGetSlackUserInfo(params, updateStatus)
        ),
      }),
      getSlackChannelInfo: tool({
        description: 'Get information about a Slack channel',
        parameters: z.object({
          channelNameOrId: z
            .string()
            .describe('Channel name (with or without #) or channel ID'),
        }),
        execute: createMemoryAwareToolExecutor(
          'getSlackChannelInfo',
          (params: any) => executeGetSlackChannelInfo(params, updateStatus)
        ),
      }),
      joinSlackChannel: tool({
        description: 'Join a Slack channel',
        parameters: z.object({
          channelId: z.string().describe('The channel ID to join'),
        }),
        execute: createMemoryAwareToolExecutor(
          'joinSlackChannel',
          (params: any) => executeJoinSlackChannel(params, updateStatus)
        ),
      }),
      searchSlackMessages: tool({
        description: 'Search for messages in the Slack workspace',
        parameters: z.object({
          query: z.string().describe('The search query'),
          count: z
            .number()
            .describe(
              'Number of results to return (default: 20). Use 20 if not specified.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'searchSlackMessages',
          (params: any) => executeSearchSlackMessages(params, updateStatus)
        ),
      }),
      setSlackStatus: tool({
        description: 'Set the bot user status in Slack',
        parameters: z.object({
          statusText: z.string().describe('The status text to set'),
          statusEmoji: z
            .string()
            .describe(
              'Optional status emoji (e.g., ":robot_face:"). Leave empty if not setting an emoji.'
            ),
          statusExpiration: z
            .number()
            .describe(
              'Optional expiration timestamp (Unix timestamp). Use 0 if no expiration.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'setSlackStatus',
          (params: any) => executeSetSlackStatus(params, updateStatus)
        ),
      }),
      pinSlackMessage: tool({
        description: 'Pin a message to a Slack channel',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          timestamp: z.string().describe('The message timestamp'),
        }),
        execute: createMemoryAwareToolExecutor(
          'pinSlackMessage',
          (params: any) => executePinSlackMessage(params, updateStatus)
        ),
      }),
      unpinSlackMessage: tool({
        description: 'Unpin a message from a Slack channel',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          timestamp: z.string().describe('The message timestamp'),
        }),
        execute: createMemoryAwareToolExecutor(
          'unpinSlackMessage',
          (params: any) => executeUnpinSlackMessage(params, updateStatus)
        ),
      }),
      sendRichSlackMessage: tool({
        description:
          'Send a rich formatted message using Slack Block Kit to a specific channel. Use this for complex layouts, buttons, images, and structured content.',
        parameters: z.object({
          channel: z.string().describe('The channel ID to send the message to'),
          blocks: z
            .array(
              z.union([
                // Section block with text
                z
                  .object({
                    type: z.literal('section'),
                    text: z.object({
                      type: z.enum(['mrkdwn', 'plain_text']),
                      text: z.string(),
                    }),
                  })
                  .strict(),
                // Section block with fields
                z
                  .object({
                    type: z.literal('section'),
                    fields: z.array(
                      z.object({
                        type: z.enum(['mrkdwn', 'plain_text']),
                        text: z.string(),
                      })
                    ),
                  })
                  .strict(),
                // Header block
                z
                  .object({
                    type: z.literal('header'),
                    text: z.object({
                      type: z.literal('plain_text'),
                      text: z.string(),
                    }),
                  })
                  .strict(),
                // Divider block
                z
                  .object({
                    type: z.literal('divider'),
                  })
                  .strict(),
                // Context block
                z
                  .object({
                    type: z.literal('context'),
                    elements: z.array(
                      z.object({
                        type: z.enum(['mrkdwn', 'plain_text']),
                        text: z.string(),
                      })
                    ),
                  })
                  .strict(),
                // Actions block
                z
                  .object({
                    type: z.literal('actions'),
                    elements: z.array(
                      z.object({
                        type: z.literal('button'),
                        text: z.object({
                          type: z.literal('plain_text'),
                          text: z.string(),
                        }),
                        action_id: z.string(),
                        style: z.enum(['primary', 'danger']),
                      })
                    ),
                  })
                  .strict(),
                // Image block
                z
                  .object({
                    type: z.literal('image'),
                    image_url: z.string(),
                    alt_text: z.string(),
                  })
                  .strict(),
              ])
            )
            .describe(
              'Array of Slack Block Kit blocks for rich formatting. Supported types: section, header, divider, context, actions, image'
            ),
          text: z
            .string()
            .describe(
              'Fallback text for notifications (leave empty string if not needed)'
            ),
          threadTs: z
            .string()
            .describe(
              'Thread timestamp to reply in a thread (leave empty string if not replying to a thread)'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'sendRichSlackMessage',
          (params: any) => executeSendRichSlackMessage(params, updateStatus)
        ),
      }),
      sendRichChannelMessage: tool({
        description:
          'Send a rich formatted message using Slack Block Kit to a channel by name or ID. Use this for complex layouts, buttons, images, and structured content.',
        parameters: z.object({
          channelNameOrId: z
            .string()
            .describe('Channel name (with or without #) or channel ID'),
          blocks: z
            .array(
              z.union([
                // Section block with text
                z
                  .object({
                    type: z.literal('section'),
                    text: z.object({
                      type: z.enum(['mrkdwn', 'plain_text']),
                      text: z.string(),
                    }),
                  })
                  .strict(),
                // Section block with fields
                z
                  .object({
                    type: z.literal('section'),
                    fields: z.array(
                      z.object({
                        type: z.enum(['mrkdwn', 'plain_text']),
                        text: z.string(),
                      })
                    ),
                  })
                  .strict(),
                // Header block
                z
                  .object({
                    type: z.literal('header'),
                    text: z.object({
                      type: z.literal('plain_text'),
                      text: z.string(),
                    }),
                  })
                  .strict(),
                // Divider block
                z
                  .object({
                    type: z.literal('divider'),
                  })
                  .strict(),
                // Context block
                z
                  .object({
                    type: z.literal('context'),
                    elements: z.array(
                      z.object({
                        type: z.enum(['mrkdwn', 'plain_text']),
                        text: z.string(),
                      })
                    ),
                  })
                  .strict(),
                // Actions block
                z
                  .object({
                    type: z.literal('actions'),
                    elements: z.array(
                      z.object({
                        type: z.literal('button'),
                        text: z.object({
                          type: z.literal('plain_text'),
                          text: z.string(),
                        }),
                        action_id: z.string(),
                        style: z.enum(['primary', 'danger']),
                      })
                    ),
                  })
                  .strict(),
                // Image block
                z
                  .object({
                    type: z.literal('image'),
                    image_url: z.string(),
                    alt_text: z.string(),
                  })
                  .strict(),
              ])
            )
            .describe(
              'Array of Slack Block Kit blocks for rich formatting. Supported types: section, header, divider, context, actions, image'
            ),
          text: z
            .string()
            .describe(
              'Fallback text for notifications (leave empty string if not needed)'
            ),
          threadTs: z
            .string()
            .describe(
              'Thread timestamp to reply in a thread (leave empty string if not replying to a thread)'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'sendRichChannelMessage',
          (params: any) => executeSendRichChannelMessage(params, updateStatus)
        ),
      }),
      sendRichDirectMessage: tool({
        description:
          'Send a rich formatted direct message using Slack Block Kit to a user. Use this for complex layouts, buttons, images, and structured content.',
        parameters: z.object({
          userIdOrEmail: z
            .string()
            .describe('User ID or email address of the recipient'),
          blocks: z
            .array(
              z.union([
                // Section block with text
                z
                  .object({
                    type: z.literal('section'),
                    text: z.object({
                      type: z.enum(['mrkdwn', 'plain_text']),
                      text: z.string(),
                    }),
                  })
                  .strict(),
                // Section block with fields
                z
                  .object({
                    type: z.literal('section'),
                    fields: z.array(
                      z.object({
                        type: z.enum(['mrkdwn', 'plain_text']),
                        text: z.string(),
                      })
                    ),
                  })
                  .strict(),
                // Header block
                z
                  .object({
                    type: z.literal('header'),
                    text: z.object({
                      type: z.literal('plain_text'),
                      text: z.string(),
                    }),
                  })
                  .strict(),
                // Divider block
                z
                  .object({
                    type: z.literal('divider'),
                  })
                  .strict(),
                // Context block
                z
                  .object({
                    type: z.literal('context'),
                    elements: z.array(
                      z.object({
                        type: z.enum(['mrkdwn', 'plain_text']),
                        text: z.string(),
                      })
                    ),
                  })
                  .strict(),
                // Actions block
                z
                  .object({
                    type: z.literal('actions'),
                    elements: z.array(
                      z.object({
                        type: z.literal('button'),
                        text: z.object({
                          type: z.literal('plain_text'),
                          text: z.string(),
                        }),
                        action_id: z.string(),
                        style: z.enum(['primary', 'danger']),
                      })
                    ),
                  })
                  .strict(),
                // Image block
                z
                  .object({
                    type: z.literal('image'),
                    image_url: z.string(),
                    alt_text: z.string(),
                  })
                  .strict(),
              ])
            )
            .describe(
              'Array of Slack Block Kit blocks for rich formatting. Supported types: section, header, divider, context, actions, image'
            ),
          text: z
            .string()
            .describe(
              'Fallback text for notifications (leave empty string if not needed)'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'sendRichDirectMessage',
          (params: any) => executeSendRichDirectMessage(params, updateStatus)
        ),
      }),
      createFormattedSlackMessage: tool({
        description:
          'Create a beautifully formatted Slack message with structured layout using Block Kit. Perfect for status updates, issue summaries, reports, and rich content.',
        parameters: z.object({
          channel: z
            .string()
            .describe('The channel ID or name to send the message to'),
          title: z
            .string()
            .describe(
              'Header title for the message (leave empty string if not needed)'
            ),
          content: z.string().describe('Main content text (supports markdown)'),
          fields: z
            .array(
              z.object({
                label: z.string().describe('Field label'),
                value: z.string().describe('Field value'),
              })
            )
            .describe(
              'Array of key-value fields to display (use empty array if not needed)'
            ),
          context: z
            .string()
            .describe(
              'Context text like timestamps or metadata (leave empty string if not needed)'
            ),
          actions: z
            .array(
              z.object({
                text: z.string().describe('Button text'),
                action_id: z.string().describe('Unique action identifier'),
                style: z.enum(['primary', 'danger']),
              })
            )
            .describe(
              'Array of action buttons (use empty array if not needed)'
            ),
          thread_ts: z
            .string()
            .describe(
              'Thread timestamp to reply in a thread (leave empty string if not replying to a thread)'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'createFormattedSlackMessage',
          (params: any) =>
            executeCreateFormattedSlackMessage(params, updateStatus)
        ),
      }),
      // Linear tools
      getIssueContext: tool({
        description:
          'Get the context for a Linear issue including comments, child issues, and parent issue',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID or identifier'),
          commentId: z
            .string()
            .describe(
              'Optional comment ID to highlight. Leave empty if not highlighting a specific comment.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'getIssueContext',
          (params: any) =>
            executeGetIssueContext(
              params as { issueId: string; commentId: string },
              updateStatus,
              linearClient
            )
        ),
      }),
      updateIssueStatus: tool({
        description: 'Update the status of a Linear issue',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID or identifier'),
          statusName: z
            .string()
            .describe(
              'The name of the status to set (e.g., "In Progress", "Done")'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'updateIssueStatus',
          (params: any) =>
            executeUpdateIssueStatus(
              params as { issueId: string; statusName: string },
              updateStatus,
              linearClient
            )
        ),
      }),
      addLabel: tool({
        description: 'Add a label to a Linear issue',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID'),
          labelName: z.string().describe('The name of the label to add'),
        }),
        execute: createMemoryAwareToolExecutor('addLabel', (params: any) =>
          executeAddLabel(
            params as { issueId: string; labelName: string },
            updateStatus,
            linearClient
          )
        ),
      }),
      removeLabel: tool({
        description: 'Remove a label from a Linear issue',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID'),
          labelName: z.string().describe('The name of the label to remove'),
        }),
        execute: createMemoryAwareToolExecutor('removeLabel', (params: any) =>
          executeRemoveLabel(
            params as { issueId: string; labelName: string },
            updateStatus,
            linearClient
          )
        ),
      }),
      assignIssue: tool({
        description: 'Assign a Linear issue to a team member',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID'),
          assigneeEmail: z
            .string()
            .describe('The email address of the person to assign the issue to'),
        }),
        execute: createMemoryAwareToolExecutor('assignIssue', (params: any) =>
          executeAssignIssue(
            params as { issueId: string; assigneeEmail: string },
            updateStatus,
            linearClient
          )
        ),
      }),
      createIssue: tool({
        description: 'Create a new Linear issue',
        parameters: z.object({
          teamId: z
            .string()
            .describe(
              'The Linear team ID (UUID), team key (e.g., "OTR"), or team name'
            ),
          title: z.string().describe('The title of the new issue'),
          description: z.string().describe('The description of the new issue'),
          status: z
            .string()
            .describe(
              'Optional status name for the new issue. Leave empty to use default status.'
            ),
          priority: z
            .number()
            .describe(
              'Optional priority level (1-4, where 1 is highest). Use 0 if not setting priority.'
            ),
          parentIssueId: z
            .string()
            .describe(
              'Optional parent issue ID to create this as a subtask. Leave empty if not a subtask.'
            ),
        }),
        execute: createMemoryAwareToolExecutor('createIssue', (params: any) =>
          executeCreateIssue(
            params as {
              teamId: string;
              title: string;
              description: string;
              status: string;
              priority: number;
              parentIssueId: string;
            },
            updateStatus,
            linearClient
          )
        ),
      }),
      addIssueAttachment: tool({
        description: 'Add a URL attachment to a Linear issue',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID'),
          url: z.string().describe('The URL to attach'),
          title: z.string().describe('The title for the attachment'),
        }),
        execute: createMemoryAwareToolExecutor(
          'addIssueAttachment',
          (params: any) =>
            executeAddIssueAttachment(
              params as { issueId: string; url: string; title: string },
              updateStatus,
              linearClient
            )
        ),
      }),
      updateIssuePriority: tool({
        description: 'Update the priority of a Linear issue',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID or identifier'),
          priority: z
            .number()
            .describe('The priority level (1-4, where 1 is highest)'),
        }),
        execute: createMemoryAwareToolExecutor(
          'updateIssuePriority',
          (params: any) =>
            executeUpdateIssuePriority(
              params as { issueId: string; priority: number },
              updateStatus,
              linearClient
            )
        ),
      }),
      setPointEstimate: tool({
        description: 'Set the point estimate for a Linear issue',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID or identifier'),
          pointEstimate: z.number().describe('The point estimate value'),
        }),
        execute: createMemoryAwareToolExecutor(
          'setPointEstimate',
          (params: any) =>
            executeSetPointEstimate(
              params as { issueId: string; pointEstimate: number },
              updateStatus,
              linearClient
            )
        ),
      }),
      // Linear context gathering tools
      getLinearTeams: tool({
        description:
          'Get all teams in the Linear workspace with details about members and active issues',
        parameters: z.object({}),
        execute: createMemoryAwareToolExecutor('getLinearTeams', async () => {
          return await executeGetLinearTeams(updateStatus, linearClient);
        }),
      }),
      getLinearProjects: tool({
        description:
          'Get all projects in the Linear workspace with status, progress, and team information',
        parameters: z.object({}),
        execute: createMemoryAwareToolExecutor(
          'getLinearProjects',
          async () => {
            return await executeGetLinearProjects(updateStatus, linearClient);
          }
        ),
      }),
      getLinearInitiatives: tool({
        description:
          'Get all initiatives in the Linear workspace with associated projects and progress',
        parameters: z.object({}),
        execute: createMemoryAwareToolExecutor(
          'getLinearInitiatives',
          async () => {
            return await executeGetLinearInitiatives(
              updateStatus,
              linearClient
            );
          }
        ),
      }),
      getLinearUsers: tool({
        description:
          'Get all users in the Linear workspace with their details and status',
        parameters: z.object({}),
        execute: createMemoryAwareToolExecutor('getLinearUsers', async () => {
          return await executeGetLinearUsers(updateStatus, linearClient);
        }),
      }),
      getLinearRecentIssues: tool({
        description:
          'Get recent issues from the Linear workspace, optionally filtered by team',
        parameters: z.object({
          limit: z
            .number()
            .describe(
              'Number of issues to retrieve (default: 20). Use 20 if not specified.'
            ),
          teamId: z
            .string()
            .describe(
              'Optional team ID to filter issues. Leave empty to get issues from all teams.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'getLinearRecentIssues',
          async (params: any) => {
            return await executeGetLinearRecentIssues(
              params,
              updateStatus,
              linearClient
            );
          }
        ),
      }),
      searchLinearIssues: tool({
        description:
          'Search for Linear issues by text query in title and description',
        parameters: z.object({
          query: z
            .string()
            .describe(
              'The search query to find in issue titles and descriptions'
            ),
          limit: z
            .number()
            .describe(
              'Number of results to return (default: 10). Use 10 if not specified.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'searchLinearIssues',
          async (params: any) => {
            return await executeSearchLinearIssues(
              params,
              updateStatus,
              linearClient
            );
          }
        ),
      }),
      getLinearWorkflowStates: tool({
        description:
          'Get workflow states (statuses) for teams in the Linear workspace',
        parameters: z.object({
          teamId: z
            .string()
            .describe(
              'Optional team ID to filter workflow states. Leave empty to get states for all teams.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'getLinearWorkflowStates',
          async (params: any) => {
            return await executeGetLinearWorkflowStates(
              params,
              updateStatus,
              linearClient
            );
          }
        ),
      }),
      createLinearComment: tool({
        description: 'Create a comment on a Linear issue',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID or identifier'),
          body: z.string().describe('The comment text to add'),
        }),
        execute: createMemoryAwareToolExecutor(
          'createLinearComment',
          async (params: any) => {
            return await executeCreateLinearComment(
              params,
              updateStatus,
              linearClient
            );
          }
        ),
      }),
      // GitHub tools
      getFileContent: tool({
        description: 'Get the content of a file from a GitHub repository',
        parameters: z.object({
          path: z.string().describe('The file path in the repository'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          startLine: z
            .number()
            .describe(
              'Starting line number (default: 1). Use 1 if not specified.'
            ),
          maxLines: z
            .number()
            .describe(
              'Maximum number of lines to return (default: 200). Use 200 if not specified.'
            ),
          branch: z
            .string()
            .describe(
              'Branch name (default: repository default branch). Leave empty to use default branch.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'getFileContent',
          (params: any) => executeGetFileContent(params, updateStatus)
        ),
      }),
      createBranch: tool({
        description: 'Create a new branch in a GitHub repository',
        parameters: z.object({
          branch: z.string().describe('The name of the new branch'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          baseBranch: z
            .string()
            .describe(
              'Base branch to create from (default: repository default branch). Leave empty to use default branch.'
            ),
        }),
        execute: createMemoryAwareToolExecutor('createBranch', (params: any) =>
          executeCreateBranch(params, updateStatus)
        ),
      }),
      createOrUpdateFile: tool({
        description: 'Create or update a file in a GitHub repository',
        parameters: z.object({
          path: z.string().describe('The file path in the repository'),
          content: z.string().describe('The file content'),
          message: z.string().describe('Commit message'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          branch: z.string().describe('The branch to commit to'),
        }),
        execute: createMemoryAwareToolExecutor(
          'createOrUpdateFile',
          (params: any) => executeCreateOrUpdateFile(params, updateStatus)
        ),
      }),
      createPullRequest: tool({
        description: 'Create a pull request in a GitHub repository',
        parameters: z.object({
          title: z.string().describe('The title of the pull request'),
          body: z.string().describe('The body/description of the pull request'),
          head: z.string().describe('The branch containing the changes'),
          base: z.string().describe('The branch to merge into'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
        }),
        execute: createMemoryAwareToolExecutor(
          'createPullRequest',
          (params: any) => executeCreatePullRequest(params, updateStatus)
        ),
      }),
      getPullRequest: tool({
        description: 'Get details of a pull request including comments',
        parameters: z.object({
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          pullNumber: z.number().describe('The pull request number'),
        }),
        execute: createMemoryAwareToolExecutor(
          'getPullRequest',
          (params: any) => executeGetPullRequest(params, updateStatus)
        ),
      }),
      addPullRequestComment: tool({
        description: 'Add a comment to a pull request',
        parameters: z.object({
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          pullNumber: z.number().describe('The pull request number'),
          body: z.string().describe('The comment text'),
        }),
        execute: createMemoryAwareToolExecutor(
          'addPullRequestComment',
          (params: any) => executeAddPullRequestComment(params, updateStatus)
        ),
      }),
      getPullRequestFiles: tool({
        description: 'Get the files changed in a pull request',
        parameters: z.object({
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          pullNumber: z.number().describe('The pull request number'),
        }),
        execute: createMemoryAwareToolExecutor(
          'getPullRequestFiles',
          (params: any) => executeGetPullRequestFiles(params, updateStatus)
        ),
      }),
      getDirectoryStructure: tool({
        description: 'Get the directory structure of a GitHub repository',
        parameters: z.object({
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          directoryPath: z
            .string()
            .describe(
              'Optional directory path (default: root directory). Leave empty for root directory.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'getDirectoryStructure',
          (params: any) => executeGetDirectoryStructure(params, updateStatus)
        ),
      }),
      searchEmbeddedCode: tool({
        description:
          'Search for code in a repository using semantic vector search. This is the primary code search tool and works best for finding relevant code based on meaning and context.',
        parameters: z.object({
          query: z.string().describe('The search query'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          fileFilter: z
            .string()
            .describe(
              'Optional file filter (e.g., "*.ts" for TypeScript files). Leave empty if not filtering by file type.'
            ),
          maxResults: z
            .number()
            .describe(
              'Maximum number of results (default: 10). Use 10 if not specified.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'searchEmbeddedCode',
          (params: any) => executeSearchEmbeddedCode(params, updateStatus)
        ),
      }),
      getRepositoryStructure: tool({
        description:
          'Get the enhanced repository structure using the repository manager (supports caching and embedding-aware features, only works for embedded repositories)',
        parameters: z.object({
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          path: z
            .string()
            .describe(
              'Optional directory path to explore (default: root directory). Leave empty for root directory.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'getRepositoryStructure',
          (params: any) => executeGetRepositoryStructure(params, updateStatus)
        ),
      }),
      respondToSlackInteraction: tool({
        description:
          'Respond to a Slack interactive component (button click, etc.) using the response URL. Use this when responding to button clicks or other interactive elements.',
        parameters: z.object({
          responseUrl: z
            .string()
            .describe('The response URL provided by Slack for the interaction'),
          text: z
            .string()
            .describe(
              'Optional response text (leave empty string if not needed)'
            ),
          blocks: z
            .array(
              z.union([
                // Section block with text
                z
                  .object({
                    type: z.literal('section'),
                    text: z.object({
                      type: z.enum(['mrkdwn', 'plain_text']),
                      text: z.string(),
                    }),
                  })
                  .strict(),
                // Section block with fields
                z
                  .object({
                    type: z.literal('section'),
                    fields: z.array(
                      z.object({
                        type: z.enum(['mrkdwn', 'plain_text']),
                        text: z.string(),
                      })
                    ),
                  })
                  .strict(),
                // Header block
                z
                  .object({
                    type: z.literal('header'),
                    text: z.object({
                      type: z.literal('plain_text'),
                      text: z.string(),
                    }),
                  })
                  .strict(),
                // Divider block
                z
                  .object({
                    type: z.literal('divider'),
                  })
                  .strict(),
                // Context block
                z
                  .object({
                    type: z.literal('context'),
                    elements: z.array(
                      z.object({
                        type: z.enum(['mrkdwn', 'plain_text']),
                        text: z.string(),
                      })
                    ),
                  })
                  .strict(),
                // Actions block
                z
                  .object({
                    type: z.literal('actions'),
                    elements: z.array(
                      z.object({
                        type: z.literal('button'),
                        text: z.object({
                          type: z.literal('plain_text'),
                          text: z.string(),
                        }),
                        action_id: z.string(),
                        style: z.enum(['primary', 'danger']),
                      })
                    ),
                  })
                  .strict(),
                // Image block
                z
                  .object({
                    type: z.literal('image'),
                    image_url: z.string(),
                    alt_text: z.string(),
                  })
                  .strict(),
              ])
            )
            .describe(
              'Optional Block Kit blocks for rich formatting (use empty array if not needed)'
            ),
          replaceOriginal: z
            .boolean()
            .describe(
              'Whether to replace the original message (true) or send a new message (false)'
            ),
          deleteOriginal: z
            .boolean()
            .describe('Whether to delete the original message'),
          responseType: z
            .enum(['ephemeral', 'in_channel'])
            .describe(
              'Whether the response should be ephemeral (only visible to the user) or in_channel (visible to everyone). Use "ephemeral" if not specified.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'respondToSlackInteraction',
          (params: any) =>
            executeRespondToSlackInteraction(params, updateStatus)
        ),
      }),
      // Advanced GitHub file editing tools
      insertAtLine: tool({
        description:
          'Insert content at a specific line number in a file. This is safer than replacing entire files.',
        parameters: z.object({
          path: z.string().describe('The file path in the repository'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          branch: z.string().describe('The branch to edit'),
          line: z
            .number()
            .describe('The line number where to insert content (1-based)'),
          content: z.string().describe('The content to insert'),
          message: z.string().describe('Commit message for the change'),
        }),
        execute: createMemoryAwareToolExecutor('insertAtLine', (params: any) =>
          executeInsertAtLine(params, updateStatus)
        ),
      }),
      replaceLines: tool({
        description:
          'Replace a specific range of lines in a file. Much safer than replacing entire files.',
        parameters: z.object({
          path: z.string().describe('The file path in the repository'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          branch: z.string().describe('The branch to edit'),
          startLine: z
            .number()
            .describe(
              'The starting line number to replace (1-based, inclusive)'
            ),
          endLine: z
            .number()
            .describe('The ending line number to replace (1-based, inclusive)'),
          content: z
            .string()
            .describe('The new content to replace the lines with'),
          message: z.string().describe('Commit message for the change'),
        }),
        execute: createMemoryAwareToolExecutor('replaceLines', (params: any) =>
          executeReplaceLines(params, updateStatus)
        ),
      }),
      deleteLines: tool({
        description: 'Delete a specific range of lines from a file.',
        parameters: z.object({
          path: z.string().describe('The file path in the repository'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          branch: z.string().describe('The branch to edit'),
          startLine: z
            .number()
            .describe(
              'The starting line number to delete (1-based, inclusive)'
            ),
          endLine: z
            .number()
            .describe('The ending line number to delete (1-based, inclusive)'),
          message: z.string().describe('Commit message for the change'),
        }),
        execute: createMemoryAwareToolExecutor('deleteLines', (params: any) =>
          executeDeleteLines(params, updateStatus)
        ),
      }),
      appendToFile: tool({
        description: 'Append content to the end of a file.',
        parameters: z.object({
          path: z.string().describe('The file path in the repository'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          branch: z.string().describe('The branch to edit'),
          content: z.string().describe('The content to append'),
          message: z.string().describe('Commit message for the change'),
        }),
        execute: createMemoryAwareToolExecutor('appendToFile', (params: any) =>
          executeAppendToFile(params, updateStatus)
        ),
      }),
      prependToFile: tool({
        description: 'Prepend content to the beginning of a file.',
        parameters: z.object({
          path: z.string().describe('The file path in the repository'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          branch: z.string().describe('The branch to edit'),
          content: z.string().describe('The content to prepend'),
          message: z.string().describe('Commit message for the change'),
        }),
        execute: createMemoryAwareToolExecutor('prependToFile', (params: any) =>
          executePrependToFile(params, updateStatus)
        ),
      }),
      findAndReplace: tool({
        description:
          'Find and replace text in a file with options for case sensitivity and whole word matching.',
        parameters: z.object({
          path: z.string().describe('The file path in the repository'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          branch: z.string().describe('The branch to edit'),
          searchText: z.string().describe('The text to search for'),
          replaceText: z.string().describe('The text to replace with'),
          message: z.string().describe('Commit message for the change'),
          replaceAll: z
            .boolean()
            .describe(
              'Whether to replace all occurrences (true) or just the first one (false). Default: false.'
            ),
          caseSensitive: z
            .boolean()
            .describe(
              'Whether the search should be case sensitive. Default: true.'
            ),
          wholeWord: z
            .boolean()
            .describe('Whether to match whole words only. Default: false.'),
        }),
        execute: createMemoryAwareToolExecutor(
          'findAndReplace',
          (params: any) => executeFindAndReplace(params, updateStatus)
        ),
      }),
      insertAfterPattern: tool({
        description:
          'Insert content after the first line that matches a specific pattern.',
        parameters: z.object({
          path: z.string().describe('The file path in the repository'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          branch: z.string().describe('The branch to edit'),
          pattern: z.string().describe('The pattern to search for'),
          content: z
            .string()
            .describe('The content to insert after the matching line'),
          message: z.string().describe('Commit message for the change'),
          caseSensitive: z
            .boolean()
            .describe(
              'Whether the search should be case sensitive. Default: true.'
            ),
          wholeWord: z
            .boolean()
            .describe('Whether to match whole words only. Default: false.'),
        }),
        execute: createMemoryAwareToolExecutor(
          'insertAfterPattern',
          (params: any) => executeInsertAfterPattern(params, updateStatus)
        ),
      }),
      insertBeforePattern: tool({
        description:
          'Insert content before the first line that matches a specific pattern.',
        parameters: z.object({
          path: z.string().describe('The file path in the repository'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          branch: z.string().describe('The branch to edit'),
          pattern: z.string().describe('The pattern to search for'),
          content: z
            .string()
            .describe('The content to insert before the matching line'),
          message: z.string().describe('Commit message for the change'),
          caseSensitive: z
            .boolean()
            .describe(
              'Whether the search should be case sensitive. Default: true.'
            ),
          wholeWord: z
            .boolean()
            .describe('Whether to match whole words only. Default: false.'),
        }),
        execute: createMemoryAwareToolExecutor(
          'insertBeforePattern',
          (params: any) => executeInsertBeforePattern(params, updateStatus)
        ),
      }),
      applyMultipleEdits: tool({
        description:
          'Apply multiple edit operations to a file in a single commit. Operations are applied in reverse line order to avoid line number conflicts.',
        parameters: z.object({
          path: z.string().describe('The file path in the repository'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          branch: z.string().describe('The branch to edit'),
          operations: z
            .array(
              z.discriminatedUnion('type', [
                z.object({
                  type: z.literal('insert'),
                  line: z
                    .number()
                    .describe('Line number for insert operation (1-based)'),
                  content: z.string().describe('Content to insert'),
                }),
                z.object({
                  type: z.literal('replace'),
                  startLine: z
                    .number()
                    .describe(
                      'Starting line for replace operation (1-based, inclusive)'
                    ),
                  endLine: z
                    .number()
                    .describe(
                      'Ending line for replace operation (1-based, inclusive)'
                    ),
                  content: z.string().describe('Content to replace with'),
                }),
                z.object({
                  type: z.literal('delete'),
                  startLine: z
                    .number()
                    .describe(
                      'Starting line for delete operation (1-based, inclusive)'
                    ),
                  endLine: z
                    .number()
                    .describe(
                      'Ending line for delete operation (1-based, inclusive)'
                    ),
                }),
              ])
            )
            .describe('Array of edit operations to apply'),
          message: z.string().describe('Commit message for all the changes'),
        }),
        execute: createMemoryAwareToolExecutor(
          'applyMultipleEdits',
          (params: any) => executeApplyMultipleEdits(params, updateStatus)
        ),
      }),
      resetBranchToHead: tool({
        description:
          'Reset a branch to the head of another branch (or the default branch). This will force update the branch to match the target branch exactly.',
        parameters: z.object({
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          branch: z.string().describe('The branch to reset'),
          baseBranch: z
            .string()
            .describe(
              'The branch to reset to (defaults to the repository default branch)'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'resetBranchToHead',
          (params: any) => executeResetBranchToHead(params, updateStatus)
        ),
      }),
      // Advanced file reading and analysis tools
      readFileWithContext: tool({
        description:
          'Read a file with intelligent context around specific lines, patterns, functions, or classes. Much more powerful than basic file reading.',
        parameters: z.object({
          path: z.string().describe('The file path in the repository'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          targetLine: z
            .number()
            .describe(
              'Specific line number to focus on (1-based). Use 0 if not targeting a specific line.'
            ),
          searchPattern: z
            .string()
            .describe(
              'Pattern to search for and provide context around. Leave empty if not searching for a pattern.'
            ),
          functionName: z
            .string()
            .describe(
              'Function name to find and provide context for. Leave empty if not searching for a function.'
            ),
          className: z
            .string()
            .describe(
              'Class name to find and provide context for. Leave empty if not searching for a class.'
            ),
          contextLines: z
            .number()
            .describe(
              'Number of context lines before and after (default: 5). Use 5 if not specified.'
            ),
          maxLines: z
            .number()
            .describe(
              'Maximum number of lines to return (default: 100). Use 100 if not specified.'
            ),
          branch: z
            .string()
            .describe(
              'Branch to read from (defaults to default branch). Leave empty to use default branch.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'readFileWithContext',
          (params: any) => executeReadFileWithContext(params, updateStatus)
        ),
      }),
      analyzeFileStructure: tool({
        description:
          'Analyze a file to extract its structure including functions, classes, imports, exports, and complexity metrics.',
        parameters: z.object({
          path: z.string().describe('The file path in the repository'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          branch: z
            .string()
            .describe(
              'Branch to analyze (defaults to default branch). Leave empty to use default branch.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'analyzeFileStructure',
          (params: any) => executeAnalyzeFileStructure(params, updateStatus)
        ),
      }),
      readRelatedFiles: tool({
        description:
          'Read multiple related files for a given file, including imports, tests, and type definitions.',
        parameters: z.object({
          mainPath: z
            .string()
            .describe('The main file path to find related files for'),
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          includeImports: z
            .boolean()
            .describe(
              'Include imported files (default: true). Use true if not specified.'
            ),
          includeTests: z
            .boolean()
            .describe(
              'Include test files (default: true). Use true if not specified.'
            ),
          includeTypes: z
            .boolean()
            .describe(
              'Include type definition files (default: true). Use true if not specified.'
            ),
          maxFiles: z
            .number()
            .describe(
              'Maximum number of related files to read (default: 10). Use 10 if not specified.'
            ),
          branch: z
            .string()
            .describe(
              'Branch to read from (defaults to default branch). Leave empty to use default branch.'
            ),
        }),
        execute: createMemoryAwareToolExecutor(
          'readRelatedFiles',
          (params: any) => executeReadRelatedFiles(params, updateStatus)
        ),
      }),
    },
  });

  // Store the assistant's response in memory
  try {
    await memoryManager.storeMemory(contextId, 'conversation', {
      role: 'assistant',
      content: [{ type: 'text', text }],
    });
  } catch (error) {
    console.error('Error storing assistant response in memory:', error);
  }

  return {
    text,
    toolsUsed: Array.from(executionTracker.toolsUsed),
    actionsPerformed: executionTracker.actionsPerformed,
    endedExplicitly: executionTracker.endedExplicitly,
  };
};
