import { openai } from '@ai-sdk/openai';
import { CoreMessage, generateText, tool } from 'ai';
import { z } from 'zod';
import {
  executeGetWeather,
  executeSearchWeb,
  executeGetIssueContext,
  executeUpdateIssueStatus,
  executeAddLabel,
  executeRemoveLabel,
  executeAssignIssue,
  executeCreateIssue,
  executeAddIssueAttachment,
  executeUpdateIssuePriority,
  executeSetPointEstimate,
  executeGetFileContent,
  executeCreateBranch,
  executeCreateOrUpdateFile,
  executeCreatePullRequest,
  executeGetPullRequest,
  executeAddPullRequestComment,
  executeGetPullRequestFiles,
  executeSearchCode,
  executeGetDirectoryStructure,
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
  executeGetSlackPermalink,
  executeSetSlackStatus,
  executePinSlackMessage,
  executeUnpinSlackMessage,
  executeSendRichSlackMessage,
  executeSendRichChannelMessage,
  executeSendRichDirectMessage,
  executeCreateFormattedSlackMessage,
  executeGetLinearTeams,
  executeGetLinearProjects,
  executeGetLinearInitiatives,
  executeGetLinearUsers,
  executeGetLinearRecentIssues,
  executeSearchLinearIssues,
  executeGetLinearWorkflowStates,
  executeCreateLinearComment,
} from './tool-executors.js';
import { LinearClient } from '@linear/sdk';

export const generateResponse = async (
  messages: CoreMessage[],
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient,
  slackContext?: {
    channelId: string;
    threadTs?: string;
  }
) => {
  const { text } = await generateText({
    model: openai('o4-mini'),
    system: `You are Otron. An omnipresent AI agent. You exist across Slack, Linear, and GitHub.
    - You keep your responses concise and to the point, but friendly and engaging while being as helpful as possible.
    - You can be notified to take action via all 3 platforms, and can take actions on all 3 platforms.
    
    CRITICAL: You must EXPLICITLY decide where and how to respond using your available tools.
    - When you receive a message from Slack, you are NOT automatically responding to Slack - you must use Slack tools to send messages if you want to respond there.
    - When you receive a Linear notification, you are NOT automatically commenting on Linear - you must use Linear tools to create comments if you want to respond there.
    - You have full control over whether to respond, where to respond, and what actions to take.
    - You can choose to respond on the same platform, a different platform, multiple platforms, or not respond at all.
    - Use the appropriate tools (sendSlackMessage, createIssue, addPullRequestComment, etc.) to take any actions you deem necessary.

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
    - Interactive content with buttons
    - Multi-section content with dividers
    - Lists with proper formatting
    
    Common Block Kit patterns:
    1. Header + Section: [{"type": "header", "text": {"type": "plain_text", "text": "Title"}}, {"type": "section", "text": {"type": "mrkdwn", "text": "Content"}}]
    2. Fields for data: [{"type": "section", "fields": [{"type": "mrkdwn", "text": "*Field:*\\nValue"}]}]
    3. Dividers for separation: [{"type": "divider"}]
    4. Context for metadata: [{"type": "context", "elements": [{"type": "mrkdwn", "text": "Last updated: 2024-01-01"}]}]
    5. Actions with buttons: [{"type": "actions", "elements": [{"type": "button", "text": {"type": "plain_text", "text": "Click Me"}, "action_id": "button_click"}]}]

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

    Final notes:
    - Current date is: ${new Date().toISOString().split('T')[0]}
    - Make sure to ALWAYS include sources in your final response if you use web search. Put sources inline if possible.
    - Remember: You control all communication - use your tools to respond where and how you see fit.
    - Choose rich Block Kit messages when the content benefits from visual structure, formatting, or interactivity.`,
    messages,
    maxSteps: 10,
    tools: {
      getWeather: tool({
        description: 'Get the current weather at a location',
        parameters: z.object({
          latitude: z.number(),
          longitude: z.number(),
          city: z.string(),
        }),
        execute: (params) => executeGetWeather(params, updateStatus),
      }),
      searchWeb: tool({
        description: 'Use this to search the web for information',
        parameters: z.object({
          query: z.string().describe('The search query'),
        }),
        execute: (params) => executeSearchWeb(params, updateStatus),
      }),
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
        execute: (params) => executeSendSlackMessage(params, updateStatus),
      }),
      sendDirectMessage: tool({
        description: 'Send a direct message to a Slack user',
        parameters: z.object({
          userIdOrEmail: z
            .string()
            .describe('User ID or email address of the recipient'),
          text: z.string().describe('The message text to send'),
        }),
        execute: (params) => executeSendDirectMessage(params, updateStatus),
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
        execute: (params) => executeSendChannelMessage(params, updateStatus),
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
        execute: (params) => executeAddSlackReaction(params, updateStatus),
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
        execute: (params) => executeRemoveSlackReaction(params, updateStatus),
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
        execute: (params) =>
          executeGetSlackChannelHistory(params, updateStatus),
      }),
      getSlackThread: tool({
        description: 'Get all messages in a Slack thread',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          threadTs: z.string().describe('The thread timestamp'),
        }),
        execute: (params) => executeGetSlackThread(params, updateStatus),
      }),
      updateSlackMessage: tool({
        description: 'Update an existing Slack message',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          timestamp: z.string().describe('The message timestamp'),
          text: z.string().describe('The new message text'),
        }),
        execute: (params) => executeUpdateSlackMessage(params, updateStatus),
      }),
      deleteSlackMessage: tool({
        description: 'Delete a Slack message',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          timestamp: z.string().describe('The message timestamp'),
        }),
        execute: (params) => executeDeleteSlackMessage(params, updateStatus),
      }),
      getSlackUserInfo: tool({
        description: 'Get information about a Slack user',
        parameters: z.object({
          userIdOrEmail: z
            .string()
            .describe('User ID or email address to look up'),
        }),
        execute: (params) => executeGetSlackUserInfo(params, updateStatus),
      }),
      getSlackChannelInfo: tool({
        description: 'Get information about a Slack channel',
        parameters: z.object({
          channelNameOrId: z
            .string()
            .describe('Channel name (with or without #) or channel ID'),
        }),
        execute: (params) => executeGetSlackChannelInfo(params, updateStatus),
      }),
      joinSlackChannel: tool({
        description: 'Join a Slack channel',
        parameters: z.object({
          channelId: z.string().describe('The channel ID to join'),
        }),
        execute: (params) => executeJoinSlackChannel(params, updateStatus),
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
        execute: (params) => executeSearchSlackMessages(params, updateStatus),
      }),
      getSlackPermalink: tool({
        description: 'Get a permalink for a Slack message',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          messageTs: z.string().describe('The message timestamp'),
        }),
        execute: (params) => executeGetSlackPermalink(params, updateStatus),
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
        execute: (params) => executeSetSlackStatus(params, updateStatus),
      }),
      pinSlackMessage: tool({
        description: 'Pin a message to a Slack channel',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          timestamp: z.string().describe('The message timestamp'),
        }),
        execute: (params) => executePinSlackMessage(params, updateStatus),
      }),
      unpinSlackMessage: tool({
        description: 'Unpin a message from a Slack channel',
        parameters: z.object({
          channel: z.string().describe('The channel ID'),
          timestamp: z.string().describe('The message timestamp'),
        }),
        execute: (params) => executeUnpinSlackMessage(params, updateStatus),
      }),
      sendRichSlackMessage: tool({
        description:
          'Send a rich formatted message using Slack Block Kit to a specific channel. Use this for complex layouts, buttons, images, and structured content.',
        parameters: z.object({
          channel: z.string().describe('The channel ID to send the message to'),
          blocks: z
            .array(z.any())
            .describe(
              'Array of Slack Block Kit blocks for rich formatting. Common blocks: section (text), header, divider, image, actions (buttons), context'
            ),
          text: z
            .string()
            .describe(
              'Fallback text for notifications (optional but recommended)'
            ),
          threadTs: z
            .string()
            .describe(
              'Optional thread timestamp to reply in a thread. Leave empty if not replying to a thread.'
            ),
        }),
        execute: (params) => executeSendRichSlackMessage(params, updateStatus),
      }),
      sendRichChannelMessage: tool({
        description:
          'Send a rich formatted message using Slack Block Kit to a channel by name or ID. Use this for complex layouts, buttons, images, and structured content.',
        parameters: z.object({
          channelNameOrId: z
            .string()
            .describe('Channel name (with or without #) or channel ID'),
          blocks: z
            .array(z.any())
            .describe(
              'Array of Slack Block Kit blocks for rich formatting. Common blocks: section (text), header, divider, image, actions (buttons), context'
            ),
          text: z
            .string()
            .describe(
              'Fallback text for notifications (optional but recommended)'
            ),
          threadTs: z
            .string()
            .describe(
              'Optional thread timestamp to reply in a thread. Leave empty if not replying to a thread.'
            ),
        }),
        execute: (params) =>
          executeSendRichChannelMessage(params, updateStatus),
      }),
      sendRichDirectMessage: tool({
        description:
          'Send a rich formatted direct message using Slack Block Kit to a user. Use this for complex layouts, buttons, images, and structured content.',
        parameters: z.object({
          userIdOrEmail: z
            .string()
            .describe('User ID or email address of the recipient'),
          blocks: z
            .array(z.any())
            .describe(
              'Array of Slack Block Kit blocks for rich formatting. Common blocks: section (text), header, divider, image, actions (buttons), context'
            ),
          text: z
            .string()
            .describe(
              'Fallback text for notifications (optional but recommended)'
            ),
        }),
        execute: (params) => executeSendRichDirectMessage(params, updateStatus),
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
            .optional()
            .describe('Optional header title for the message'),
          content: z.string().describe('Main content text (supports markdown)'),
          fields: z
            .array(
              z.object({
                label: z.string().describe('Field label'),
                value: z.string().describe('Field value'),
              })
            )
            .optional()
            .describe('Optional array of key-value fields to display'),
          context: z
            .string()
            .optional()
            .describe('Optional context text (like timestamps, metadata)'),
          actions: z
            .array(
              z.object({
                text: z.string().describe('Button text'),
                action_id: z.string().describe('Unique action identifier'),
                style: z
                  .enum(['primary', 'danger'])
                  .optional()
                  .describe('Button style'),
              })
            )
            .optional()
            .describe('Optional array of action buttons'),
          thread_ts: z
            .string()
            .optional()
            .describe('Optional thread timestamp to reply in a thread'),
        }),
        execute: (params) =>
          executeCreateFormattedSlackMessage(params, updateStatus),
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
        execute: (params) =>
          executeGetIssueContext(
            params as { issueId: string; commentId: string },
            updateStatus,
            linearClient
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
        execute: (params) =>
          executeUpdateIssueStatus(
            params as { issueId: string; statusName: string },
            updateStatus,
            linearClient
          ),
      }),
      addLabel: tool({
        description: 'Add a label to a Linear issue',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID'),
          labelName: z.string().describe('The name of the label to add'),
        }),
        execute: (params) =>
          executeAddLabel(
            params as { issueId: string; labelName: string },
            updateStatus,
            linearClient
          ),
      }),
      removeLabel: tool({
        description: 'Remove a label from a Linear issue',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID'),
          labelName: z.string().describe('The name of the label to remove'),
        }),
        execute: (params) =>
          executeRemoveLabel(
            params as { issueId: string; labelName: string },
            updateStatus,
            linearClient
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
        execute: (params) =>
          executeAssignIssue(
            params as { issueId: string; assigneeEmail: string },
            updateStatus,
            linearClient
          ),
      }),
      createIssue: tool({
        description: 'Create a new Linear issue',
        parameters: z.object({
          teamId: z.string().describe('The Linear team ID'),
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
        execute: (params) =>
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
          ),
      }),
      addIssueAttachment: tool({
        description: 'Add a URL attachment to a Linear issue',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID'),
          url: z.string().describe('The URL to attach'),
          title: z.string().describe('The title for the attachment'),
        }),
        execute: (params) =>
          executeAddIssueAttachment(
            params as { issueId: string; url: string; title: string },
            updateStatus,
            linearClient
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
        execute: (params) =>
          executeUpdateIssuePriority(
            params as { issueId: string; priority: number },
            updateStatus,
            linearClient
          ),
      }),
      setPointEstimate: tool({
        description: 'Set the point estimate for a Linear issue',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID or identifier'),
          pointEstimate: z.number().describe('The point estimate value'),
        }),
        execute: (params) =>
          executeSetPointEstimate(
            params as { issueId: string; pointEstimate: number },
            updateStatus,
            linearClient
          ),
      }),
      // Linear context gathering tools
      getLinearTeams: tool({
        description:
          'Get all teams in the Linear workspace with details about members and active issues',
        parameters: z.object({}),
        execute: async () => {
          return await executeGetLinearTeams(updateStatus, linearClient);
        },
      }),
      getLinearProjects: tool({
        description:
          'Get all projects in the Linear workspace with status, progress, and team information',
        parameters: z.object({}),
        execute: async () => {
          return await executeGetLinearProjects(updateStatus, linearClient);
        },
      }),
      getLinearInitiatives: tool({
        description:
          'Get all initiatives in the Linear workspace with associated projects and progress',
        parameters: z.object({}),
        execute: async () => {
          return await executeGetLinearInitiatives(updateStatus, linearClient);
        },
      }),
      getLinearUsers: tool({
        description:
          'Get all users in the Linear workspace with their details and status',
        parameters: z.object({}),
        execute: async () => {
          return await executeGetLinearUsers(updateStatus, linearClient);
        },
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
        execute: async (params) => {
          return await executeGetLinearRecentIssues(
            params,
            updateStatus,
            linearClient
          );
        },
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
        execute: async (params) => {
          return await executeSearchLinearIssues(
            params,
            updateStatus,
            linearClient
          );
        },
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
        execute: async (params) => {
          return await executeGetLinearWorkflowStates(
            params,
            updateStatus,
            linearClient
          );
        },
      }),
      createLinearComment: tool({
        description: 'Create a comment on a Linear issue',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID or identifier'),
          body: z.string().describe('The comment text to add'),
        }),
        execute: async (params) => {
          return await executeCreateLinearComment(
            params,
            updateStatus,
            linearClient
          );
        },
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
        execute: (params) => executeGetFileContent(params, updateStatus),
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
        execute: (params) => executeCreateBranch(params, updateStatus),
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
        execute: (params) => executeCreateOrUpdateFile(params, updateStatus),
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
        execute: (params) => executeCreatePullRequest(params, updateStatus),
      }),
      getPullRequest: tool({
        description: 'Get details of a pull request including comments',
        parameters: z.object({
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          pullNumber: z.number().describe('The pull request number'),
        }),
        execute: (params) => executeGetPullRequest(params, updateStatus),
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
        execute: (params) => executeAddPullRequestComment(params, updateStatus),
      }),
      getPullRequestFiles: tool({
        description: 'Get the files changed in a pull request',
        parameters: z.object({
          repository: z
            .string()
            .describe('The repository in format "owner/repo"'),
          pullNumber: z.number().describe('The pull request number'),
        }),
        execute: (params) => executeGetPullRequestFiles(params, updateStatus),
      }),
      searchCode: tool({
        description: 'Search for code in a GitHub repository',
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
        execute: (params) => executeSearchCode(params, updateStatus),
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
        execute: (params) => executeGetDirectoryStructure(params, updateStatus),
      }),
    },
  });

  return text;
};
