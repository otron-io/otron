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
} from './tool-executors.js';
import { LinearClient } from '@linear/sdk';

export const generateResponse = async (
  messages: CoreMessage[],
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  const { text } = await generateText({
    model: openai('o4-mini'),
    system: `You are Otron. An omnipresent AI agent. You exist across Slack, Linear, and GitHub.
    - You keep your responses concise and to the point, but friendly and engaging while being as helpful as possible.
    - You can be notified to take action via all 3 platforms, and can take actions on all 3 platforms.
    - You must decide where to respond. For example, if you are asked in Slack to take action on Linear, you should respond in Slack while also taking action on Linear.

    Final notes:
    - Current date is: ${new Date().toISOString().split('T')[0]}
    - Make sure to ALWAYS include sources in your final response if you use web search. Put sources inline if possible.`,
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
            .optional()
            .describe('Optional thread timestamp to reply in a thread'),
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
            .optional()
            .describe('Optional thread timestamp to reply in a thread'),
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
            .optional()
            .describe('Number of messages to retrieve (default: 10)'),
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
            .optional()
            .describe('Number of results to return (default: 20)'),
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
            .optional()
            .describe('Optional status emoji (e.g., ":robot_face:")'),
          statusExpiration: z
            .number()
            .optional()
            .describe('Optional expiration timestamp (Unix timestamp)'),
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
      // Linear tools
      getIssueContext: tool({
        description:
          'Get the context for a Linear issue including comments, child issues, and parent issue',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID or identifier'),
          commentId: z
            .string()
            .optional()
            .describe('Optional comment ID to highlight'),
        }),
        execute: (params) =>
          executeGetIssueContext(
            params as { issueId: string; commentId?: string },
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
            .optional()
            .describe('Optional status name for the new issue'),
          priority: z
            .number()
            .optional()
            .describe('Optional priority level (1-4, where 1 is highest)'),
          parentIssueId: z
            .string()
            .optional()
            .describe('Optional parent issue ID to create this as a subtask'),
        }),
        execute: (params) =>
          executeCreateIssue(
            params as {
              teamId: string;
              title: string;
              description: string;
              status?: string;
              priority?: number;
              parentIssueId?: string;
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
            .optional()
            .describe('Starting line number (default: 1)'),
          maxLines: z
            .number()
            .optional()
            .describe('Maximum number of lines to return (default: 200)'),
          branch: z
            .string()
            .optional()
            .describe('Branch name (default: repository default branch)'),
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
            .optional()
            .describe(
              'Base branch to create from (default: repository default branch)'
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
            .optional()
            .describe(
              'Optional file filter (e.g., "*.ts" for TypeScript files)'
            ),
          maxResults: z
            .number()
            .optional()
            .describe('Maximum number of results (default: 10)'),
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
            .optional()
            .describe('Optional directory path (default: root directory)'),
        }),
        execute: (params) => executeGetDirectoryStructure(params, updateStatus),
      }),
    },
  });

  return text;
};
