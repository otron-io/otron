import * as linearUtils from './linear/linear-utils.js';
import * as githubUtils from './github/github-utils.js';
import * as slackUtils from './slack/slack-utils.js';
import { LinearClient } from '@linear/sdk';
import { FileEditor } from './github/file-editor.js';
import { advancedFileReader } from './github/file-reader.js';
import { env } from './env.js';
import { logToLinearIssue } from './linear/linear-logger.js';

// Helper function to extract Linear issue ID from branch name or context
const extractLinearIssueFromBranch = (branchName: string): string | null => {
  // Look for Linear issue patterns like OTR-123, ABC-456, etc. in branch names
  const issueMatch = branchName.match(/\b([A-Z]{2,}-\d+)\b/);
  return issueMatch ? issueMatch[1] : null;
};

// General tool execution functions
export const executeGetWeather = async (
  {
    latitude,
    longitude,
    city,
  }: { latitude: number; longitude: number; city: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is getting weather for ${city}...`);

  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weathercode,relativehumidity_2m&timezone=auto`
  );

  const weatherData = await response.json();
  return {
    temperature: weatherData.current.temperature_2m,
    weatherCode: weatherData.current.weathercode,
    humidity: weatherData.current.relativehumidity_2m,
    city,
  };
};

// Slack tool execution functions
export const executeSendSlackMessage = async (
  {
    channel,
    text,
    threadTs,
  }: { channel: string; text: string; threadTs: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is sending message to ${channel}...`);

  await slackUtils.sendMessage(channel, text, threadTs || undefined);
  return {
    success: true,
    message: `Sent message to ${channel}`,
  };
};

export const executeSendDirectMessage = async (
  { userIdOrEmail, text }: { userIdOrEmail: string; text: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is sending direct message to ${userIdOrEmail}...`);

  await slackUtils.sendDirectMessage(userIdOrEmail, text);
  return {
    success: true,
    message: `Sent direct message to ${userIdOrEmail}`,
  };
};

export const executeSendChannelMessage = async (
  {
    channelNameOrId,
    text,
    threadTs,
  }: { channelNameOrId: string; text: string; threadTs: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is sending message to channel ${channelNameOrId}...`);

  await slackUtils.sendChannelMessage(
    channelNameOrId,
    text,
    threadTs || undefined
  );
  return {
    success: true,
    message: `Sent message to channel ${channelNameOrId}`,
  };
};

export const executeAddSlackReaction = async (
  {
    channel,
    timestamp,
    emoji,
  }: { channel: string; timestamp: string; emoji: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is adding reaction ${emoji} to message...`);

  await slackUtils.addReaction(channel, timestamp, emoji);
  return {
    success: true,
    message: `Added reaction ${emoji} to message`,
  };
};

export const executeRemoveSlackReaction = async (
  {
    channel,
    timestamp,
    emoji,
  }: { channel: string; timestamp: string; emoji: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is removing reaction ${emoji} from message...`);

  await slackUtils.removeReaction(channel, timestamp, emoji);
  return {
    success: true,
    message: `Removed reaction ${emoji} from message`,
  };
};

export const executeGetSlackChannelHistory = async (
  { channel, limit }: { channel: string; limit: number },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is getting channel history for ${channel}...`);

  const history = await slackUtils.getBriefChannelHistory(
    channel,
    limit === 0 ? undefined : limit
  );
  return { history };
};

export const executeGetSlackThread = async (
  { channel, threadTs }: { channel: string; threadTs: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is getting thread from ${channel}...`);

  const botUserId = await slackUtils.getBotId();
  const thread = await slackUtils.getThread(channel, threadTs, botUserId);
  return { thread };
};

export const executeUpdateSlackMessage = async (
  {
    channel,
    timestamp,
    text,
  }: { channel: string; timestamp: string; text: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is updating message in ${channel}...`);

  await slackUtils.updateMessage(channel, timestamp, text);
  return {
    success: true,
    message: `Updated message in ${channel}`,
  };
};

export const executeDeleteSlackMessage = async (
  { channel, timestamp }: { channel: string; timestamp: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is deleting message from ${channel}...`);

  await slackUtils.deleteMessage(channel, timestamp);
  return {
    success: true,
    message: `Deleted message from ${channel}`,
  };
};

export const executeGetSlackUserInfo = async (
  { userIdOrEmail }: { userIdOrEmail: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is getting user info for ${userIdOrEmail}...`);

  let userInfo;
  if (userIdOrEmail.includes('@')) {
    userInfo = await slackUtils.getUserByEmail(userIdOrEmail);
  } else {
    userInfo = await slackUtils.getUserInfo(userIdOrEmail);
  }

  return { userInfo };
};

export const executeGetSlackChannelInfo = async (
  { channelNameOrId }: { channelNameOrId: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is getting channel info for ${channelNameOrId}...`);

  let channelInfo;
  if (channelNameOrId.startsWith('#')) {
    const channelName = channelNameOrId.slice(1);
    channelInfo = await slackUtils.getChannelByName(channelName);
  } else {
    channelInfo = await slackUtils.getChannelInfo(channelNameOrId);
  }

  return { channelInfo };
};

export const executeJoinSlackChannel = async (
  { channelId }: { channelId: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is joining channel ${channelId}...`);

  await slackUtils.joinChannel(channelId);
  return {
    success: true,
    message: `Joined channel ${channelId}`,
  };
};

export const executeSearchSlackMessages = async (
  { query, count }: { query: string; count: number },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is searching for messages: "${query}"...`);

  const results = await slackUtils.searchMessages(query, {
    count: count === 0 ? undefined : count,
  });
  return { results };
};

export const executeGetSlackPermalink = async (
  { channel, messageTs }: { channel: string; messageTs: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is getting permalink for message...`);

  const permalink = await slackUtils.getPermalink(channel, messageTs);
  return { permalink };
};

export const executeSetSlackStatus = async (
  {
    statusText,
    statusEmoji,
    statusExpiration,
  }: { statusText: string; statusEmoji: string; statusExpiration: number },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is setting status to "${statusText}"...`);

  await slackUtils.setStatus(
    statusText,
    statusEmoji || undefined,
    statusExpiration === 0 ? undefined : statusExpiration
  );
  return {
    success: true,
    message: `Set status to "${statusText}"`,
  };
};

export const executePinSlackMessage = async (
  { channel, timestamp }: { channel: string; timestamp: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is pinning message in ${channel}...`);

  await slackUtils.pinMessage(channel, timestamp);
  return {
    success: true,
    message: `Pinned message in ${channel}`,
  };
};

export const executeUnpinSlackMessage = async (
  { channel, timestamp }: { channel: string; timestamp: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is unpinning message in ${channel}...`);

  await slackUtils.unpinMessage(channel, timestamp);
  return {
    success: true,
    message: `Unpinned message in ${channel}`,
  };
};

export const executeSendRichSlackMessage = async (
  {
    channel,
    blocks,
    text,
    threadTs,
  }: {
    channel: string;
    blocks: any[];
    text: string;
    threadTs: string;
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is sending rich message to ${channel}...`);

  await slackUtils.sendRichMessage(
    channel,
    blocks,
    text || undefined,
    threadTs || undefined
  );
  return {
    success: true,
    message: `Sent rich message to ${channel}`,
  };
};

export const executeSendRichChannelMessage = async (
  {
    channelNameOrId,
    blocks,
    text,
    threadTs,
  }: {
    channelNameOrId: string;
    blocks: any[];
    text: string;
    threadTs: string;
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is sending rich message to channel ${channelNameOrId}...`);

  // Handle channel name resolution
  let channelId = channelNameOrId;
  if (channelNameOrId.startsWith('#')) {
    const channelName = channelNameOrId.slice(1);
    const channelInfo = await slackUtils.getChannelByName(channelName);
    if (!channelInfo?.id) {
      throw new Error(`Channel ${channelName} not found`);
    }
    channelId = channelInfo.id;
  }

  await slackUtils.sendRichMessage(
    channelId,
    blocks,
    text || undefined,
    threadTs || undefined
  );
  return {
    success: true,
    message: `Sent rich message to channel ${channelNameOrId}`,
  };
};

export const executeSendRichDirectMessage = async (
  {
    userIdOrEmail,
    blocks,
    text,
  }: {
    userIdOrEmail: string;
    blocks: any[];
    text: string;
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is sending rich direct message to ${userIdOrEmail}...`);

  // Handle user resolution
  let userId = userIdOrEmail;
  if (userIdOrEmail.includes('@')) {
    const userInfo = await slackUtils.getUserByEmail(userIdOrEmail);
    if (!userInfo?.id) {
      throw new Error(`User with email ${userIdOrEmail} not found`);
    }
    userId = userInfo.id;
  }

  // Open a DM channel with the user
  const { channel } = await slackUtils.client.conversations.open({
    users: userId,
  });

  if (!channel?.id) {
    throw new Error('Failed to open DM channel');
  }

  await slackUtils.sendRichMessage(channel.id, blocks, text || undefined);
  return {
    success: true,
    message: `Sent rich direct message to ${userIdOrEmail}`,
  };
};

// Linear tool execution functions
export const executeGetIssueContext = async (
  { issueId, commentId }: { issueId: string; commentId: string },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      context:
        'ERROR: LinearClient is required for Linear operations. Please ensure Linear integration is properly configured.',
      error: 'LinearClient not available',
    };
  }

  updateStatus?.(`is getting context for issue ${issueId}...`);

  const context = await linearUtils.getIssueContext(
    linearClient,
    issueId,
    commentId || undefined
  );
  return { context };
};

export const executeUpdateIssueStatus = async (
  { issueId, statusName }: { issueId: string; statusName: string },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      success: false,
      error: 'LinearClient is required for Linear operations',
      message: 'Failed to update issue status: Linear client not available',
    };
  }

  updateStatus?.(`is updating issue ${issueId} status to ${statusName}...`);

  await linearUtils.updateIssueStatus(linearClient, issueId, statusName);
  return {
    success: true,
    message: `Updated issue ${issueId} status to ${statusName}`,
  };
};

export const executeAddLabel = async (
  { issueId, labelName }: { issueId: string; labelName: string },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      success: false,
      error: 'LinearClient is required for Linear operations',
      message: 'Failed to add label: Linear client not available',
    };
  }

  updateStatus?.(`is adding label ${labelName} to issue ${issueId}...`);

  await linearUtils.addLabel(linearClient, issueId, labelName);
  return {
    success: true,
    message: `Added label ${labelName} to issue ${issueId}`,
  };
};

export const executeRemoveLabel = async (
  { issueId, labelName }: { issueId: string; labelName: string },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      success: false,
      error: 'LinearClient is required for Linear operations',
      message: 'Failed to remove label: Linear client not available',
    };
  }

  updateStatus?.(`is removing label ${labelName} from issue ${issueId}...`);

  await linearUtils.removeLabel(linearClient, issueId, labelName);
  return {
    success: true,
    message: `Removed label ${labelName} from issue ${issueId}`,
  };
};

export const executeAssignIssue = async (
  { issueId, assigneeEmail }: { issueId: string; assigneeEmail: string },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      success: false,
      error: 'LinearClient is required for Linear operations',
      message: 'Failed to assign issue: Linear client not available',
    };
  }

  updateStatus?.(`is assigning issue ${issueId} to ${assigneeEmail}...`);

  await linearUtils.assignIssue(linearClient, issueId, assigneeEmail);
  return {
    success: true,
    message: `Assigned issue ${issueId} to ${assigneeEmail}`,
  };
};

export const executeCreateIssue = async (
  {
    teamId,
    title,
    description,
    status,
    priority,
    parentIssueId,
  }: {
    teamId: string;
    title: string;
    description: string;
    status: string;
    priority: number;
    parentIssueId: string;
  },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      success: false,
      error: 'LinearClient is required for Linear operations',
      message: 'Failed to create issue: Linear client not available',
    };
  }

  updateStatus?.(`is creating new issue "${title}"...`);

  const result = await linearUtils.createIssue(
    linearClient,
    teamId,
    title,
    description,
    status || undefined,
    priority === 0 ? undefined : priority,
    parentIssueId || undefined
  );

  return result;
};

export const executeAddIssueAttachment = async (
  { issueId, url, title }: { issueId: string; url: string; title: string },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      success: false,
      error: 'LinearClient is required for Linear operations',
      message: 'Failed to add attachment: Linear client not available',
    };
  }

  updateStatus?.(`is adding attachment "${title}" to issue ${issueId}...`);

  await linearUtils.addIssueAttachment(linearClient, issueId, url, title);
  return {
    success: true,
    message: `Added attachment "${title}" to issue ${issueId}`,
  };
};

export const executeUpdateIssuePriority = async (
  { issueId, priority }: { issueId: string; priority: number },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      success: false,
      error: 'LinearClient is required for Linear operations',
      message: 'Failed to update priority: Linear client not available',
    };
  }

  updateStatus?.(`is updating issue ${issueId} priority to ${priority}...`);

  await linearUtils.updateIssuePriority(linearClient, issueId, priority);
  return {
    success: true,
    message: `Updated issue ${issueId} priority to ${priority}`,
  };
};

export const executeSetPointEstimate = async (
  { issueId, pointEstimate }: { issueId: string; pointEstimate: number },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      success: false,
      error: 'LinearClient is required for Linear operations',
      message: 'Failed to set point estimate: Linear client not available',
    };
  }

  updateStatus?.(
    `is setting point estimate for issue ${issueId} to ${pointEstimate}...`
  );

  await linearUtils.setPointEstimate(linearClient, issueId, pointEstimate);
  return {
    success: true,
    message: `Set point estimate for issue ${issueId} to ${pointEstimate}`,
  };
};

// GitHub tool execution functions
export const executeGetFileContent = async (
  {
    path,
    repository,
    startLine,
    maxLines,
    branch,
  }: {
    path: string;
    repository: string;
    startLine: number;
    maxLines: number;
    branch: string;
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is getting content for ${path}...`);

  const content = await githubUtils.getFileContent(
    path,
    repository,
    startLine === 0 ? undefined : startLine,
    maxLines === 0 ? undefined : maxLines,
    branch || undefined
  );
  return { content };
};

export const executeCreateBranch = async (
  {
    branch,
    repository,
    baseBranch,
  }: { branch: string; repository: string; baseBranch: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is creating branch ${branch}...`);

  await githubUtils.createBranch(branch, repository, baseBranch || undefined);
  return {
    success: true,
    message: `Created branch ${branch}`,
  };
};

export const executeCreateFile = async (
  {
    path,
    content,
    message,
    repository,
    branch,
  }: {
    path: string;
    content: string;
    message: string;
    repository: string;
    branch: string;
  },
  updateStatus?: (status: string) => void
) => {
  try {
    updateStatus?.(`Creating file ${path}...`);

    // Extract Linear issue ID from branch name for logging
    const issueId = extractLinearIssueFromBranch(branch);
    if (issueId) {
      await logToLinearIssue.info(
        issueId,
        `Creating new file: ${path}`,
        `Branch: ${branch}, Repository: ${repository}`
      );
    }

    const result = await githubUtils.createOrUpdateFile(
      path,
      content,
      message,
      repository,
      branch
    );

    if (issueId) {
      await logToLinearIssue.info(
        issueId,
        `Successfully created file: ${path}`,
        `File size: ${content.length} characters`
      );
    }

    return result;
  } catch (error) {
    const issueId = extractLinearIssueFromBranch(branch);
    if (issueId) {
      await logToLinearIssue.error(
        issueId,
        `Failed to create file: ${path}`,
        error instanceof Error ? error.message : String(error)
      );
    }
    throw error;
  }
};

export const executeDeleteFile = async (
  {
    path,
    message,
    repository,
    branch,
  }: {
    path: string;
    message: string;
    repository: string;
    branch: string;
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is deleting file ${path} from ${repository}/${branch}...`);

  await githubUtils.deleteFile(path, message, repository, branch);
  return {
    success: true,
    message: `Deleted file ${path} from ${repository}/${branch}`,
  };
};

export const executeCreatePullRequest = async (
  {
    title,
    body,
    head,
    base,
    repository,
  }: {
    title: string;
    body: string;
    head: string;
    base: string;
    repository: string;
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is creating pull request "${title}" in ${repository}...`);

  const result = await githubUtils.createPullRequest(
    title,
    body,
    head,
    base,
    repository
  );
  return {
    success: true,
    url: result.url,
    number: result.number,
    message: `Created pull request #${result.number}: ${title}`,
  };
};

export const executeGetPullRequest = async (
  { repository, pullNumber }: { repository: string; pullNumber: number },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(
    `is getting details for PR #${pullNumber} in ${repository}...`
  );

  const pullRequest = await githubUtils.getPullRequest(repository, pullNumber);
  return { pullRequest };
};

export const executeAddPullRequestComment = async (
  {
    repository,
    pullNumber,
    body,
  }: { repository: string; pullNumber: number; body: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is adding comment to PR #${pullNumber} in ${repository}...`);

  const result = await githubUtils.addPullRequestComment(
    repository,
    pullNumber,
    body
  );
  return {
    success: true,
    commentId: result.id,
    url: result.url,
    message: `Added comment to PR #${pullNumber}`,
  };
};

export const executeGetPullRequestFiles = async (
  { repository, pullNumber }: { repository: string; pullNumber: number },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is getting files for PR #${pullNumber} in ${repository}...`);

  const files = await githubUtils.getPullRequestFiles(repository, pullNumber);
  return { files };
};

export const executeSearchCode = async (
  {
    query,
    repository,
    fileFilter,
    maxResults,
  }: {
    query: string;
    repository: string;
    fileFilter: string;
    maxResults: number;
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is searching for code: "${query}"...`);

  const results = await githubUtils.searchCode(query, repository, {
    fileFilter: fileFilter || undefined,
    maxResults: maxResults === 0 ? undefined : maxResults,
  });
  return { results };
};

export const executeGetDirectoryStructure = async (
  { repository, directoryPath }: { repository: string; directoryPath: string },
  updateStatus?: (status: string) => void
) => {
  try {
    updateStatus?.(
      `is getting directory structure for ${
        directoryPath || 'root'
      } in ${repository}...`
    );

    const structure = await githubUtils.getDirectoryStructure(
      repository,
      directoryPath || ''
    );
    return {
      success: true,
      structure,
      message: `Retrieved directory structure for ${
        directoryPath || 'root'
      } in ${repository}`,
    };
  } catch (error) {
    console.error(
      `Error getting directory structure for ${
        directoryPath || 'root'
      } in ${repository}:`,
      error
    );

    // Handle specific error cases
    if (error instanceof Error && 'status' in error) {
      const httpError = error as any;
      if (httpError.status === 404) {
        return {
          success: false,
          structure: [
            {
              name: `Directory not found: ${directoryPath || 'root'}`,
              path: directoryPath || '',
              type: 'file' as const,
            },
          ],
          message: `Directory "${
            directoryPath || 'root'
          }" not found in repository ${repository}. This directory may not exist or you may not have access to it.`,
        };
      }
    }

    return {
      success: false,
      structure: [
        {
          name: 'Error retrieving directory structure',
          path: directoryPath || '',
          type: 'file' as const,
        },
      ],
      message: `Failed to get directory structure: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    };
  }
};

// Linear context gathering tool execution functions
export const executeGetLinearTeams = async (
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  updateStatus?.('is getting Linear teams...');

  if (!linearClient) {
    return { error: 'Linear client not available' };
  }

  const teams = await linearUtils.getTeams(linearClient);
  return { teams };
};

export const executeGetLinearProjects = async (
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  updateStatus?.('is getting Linear projects...');

  if (!linearClient) {
    return { error: 'Linear client not available' };
  }

  const projects = await linearUtils.getProjects(linearClient);
  return { projects };
};

export const executeGetLinearInitiatives = async (
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  updateStatus?.('is getting Linear initiatives...');

  if (!linearClient) {
    return { error: 'Linear client not available' };
  }

  const initiatives = await linearUtils.getInitiatives(linearClient);
  return { initiatives };
};

export const executeGetLinearUsers = async (
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  updateStatus?.('is getting Linear users...');

  if (!linearClient) {
    return { error: 'Linear client not available' };
  }

  const users = await linearUtils.getUsers(linearClient);
  return { users };
};

export const executeGetLinearRecentIssues = async (
  { limit, teamId }: { limit: number; teamId: string },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  updateStatus?.(
    `is getting recent Linear issues${teamId ? ` for team ${teamId}` : ''}...`
  );

  if (!linearClient) {
    return { error: 'Linear client not available' };
  }

  const issues = await linearUtils.getRecentIssues(
    linearClient,
    limit || 20,
    teamId || undefined
  );
  return { issues };
};

export const executeSearchLinearIssues = async (
  { query, limit }: { query: string; limit: number },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  updateStatus?.(`is searching Linear issues for "${query}"...`);

  if (!linearClient) {
    return { error: 'Linear client not available' };
  }

  const issues = await linearUtils.searchIssues(
    linearClient,
    query,
    limit || 10
  );
  return { issues };
};

export const executeGetLinearWorkflowStates = async (
  { teamId }: { teamId: string },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  updateStatus?.(
    `is getting Linear workflow states${teamId ? ` for team ${teamId}` : ''}...`
  );

  if (!linearClient) {
    return { error: 'Linear client not available' };
  }

  const workflowStates = await linearUtils.getWorkflowStates(
    linearClient,
    teamId || undefined
  );
  return { workflowStates };
};

export const executeCreateLinearComment = async (
  { issueId, body }: { issueId: string; body: string },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      success: false,
      error: 'LinearClient is required for Linear operations',
      message: 'Failed to create comment: Linear client not available',
    };
  }

  updateStatus?.(`is creating comment on issue ${issueId}...`);

  await linearUtils.createComment(linearClient, issueId, body);
  return {
    success: true,
    message: `Created comment on issue ${issueId}`,
  };
};

export async function executeCreateFormattedSlackMessage(
  args: {
    channel: string;
    title: string;
    content: string;
    fields: Array<{ label: string; value: string }>;
    context: string;
    actions: Array<{
      text: string;
      action_id: string;
      style: 'primary' | 'danger';
    }>;
    thread_ts: string;
  },
  updateStatus?: (status: string) => void
): Promise<string> {
  try {
    const { channel, title, content, fields, context, actions, thread_ts } =
      args;

    updateStatus?.(`is creating formatted message for ${channel}...`);

    const blocks: any[] = [];

    // Add header if title provided
    if (title && title.trim()) {
      blocks.push({
        type: 'header',
        text: {
          type: 'plain_text',
          text: title,
        },
      });
    }

    // Add main content
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: content,
      },
    });

    // Add fields if provided
    if (fields && fields.length > 0) {
      blocks.push({
        type: 'section',
        fields: fields.map((field) => ({
          type: 'mrkdwn',
          text: `*${field.label}:*\n${field.value}`,
        })),
      });
    }

    // Add divider if we have context or actions
    if ((context && context.trim()) || (actions && actions.length > 0)) {
      blocks.push({ type: 'divider' });
    }

    // Add context if provided
    if (context && context.trim()) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: context,
          },
        ],
      });
    }

    // Add actions if provided
    if (actions && actions.length > 0) {
      blocks.push({
        type: 'actions',
        elements: actions.map((action) => ({
          type: 'button',
          text: {
            type: 'plain_text',
            text: action.text,
          },
          action_id: action.action_id,
          style: action.style,
        })),
      });
    }

    await slackUtils.sendRichMessage(
      channel,
      blocks,
      undefined,
      thread_ts || undefined
    );

    return `Formatted message sent successfully to ${channel}`;
  } catch (error) {
    console.error('Error sending formatted Slack message:', error);
    return `Error sending formatted message: ${
      error instanceof Error ? error.message : 'Unknown error'
    }`;
  }
}

export const executeSearchEmbeddedCode = async (
  {
    repository,
    query,
    fileFilter,
    maxResults,
  }: {
    repository: string;
    query: string;
    fileFilter?: string;
    maxResults: number;
  },
  updateStatus?: (status: string) => void
) => {
  // Add very visible logging to confirm function is called
  console.log('🚨🚨🚨 executeSearchEmbeddedCode CALLED 🚨🚨🚨');
  console.log('Parameters received:', {
    repository,
    query,
    fileFilter,
    maxResults,
  });

  try {
    updateStatus?.('is searching embedded code...');

    // Use the same direct approach as embed-ui
    const searchParams = new URLSearchParams({
      repository,
      query,
      method: 'vector',
      limit: ((maxResults <= 10 ? maxResults : 10) || 10).toString(),
    });

    if (fileFilter) {
      searchParams.append('fileFilter', fileFilter);
    }

    // Add detailed logging
    console.log('🔍 Code Search Debug Info:');
    console.log('  Repository:', repository);
    console.log('  Query:', query);
    console.log('  FileFilter:', fileFilter);
    console.log('  MaxResults:', maxResults);
    console.log('  SearchParams:', searchParams.toString());
    console.log('  INTERNAL_API_TOKEN exists:', !!env.INTERNAL_API_TOKEN);

    // Use absolute URL directly since relative URLs don't work in server environment
    const baseUrl = process.env.OTRON_URL || 'http://localhost:3000';
    const absoluteUrl = baseUrl.startsWith('http')
      ? `${baseUrl}/api/code-search?${searchParams}`
      : `https://${baseUrl}/api/code-search?${searchParams}`;

    console.log('  Using absolute URL:', absoluteUrl);

    let response: Response;
    let debugInfo = '';

    // Make the API call directly with absolute URL
    response = await fetch(absoluteUrl, {
      method: 'GET',
      headers: {
        'X-Internal-Token': env.INTERNAL_API_TOKEN,
        'Content-Type': 'application/json',
      },
    });

    debugInfo += `URL used: ${absoluteUrl}\n`;
    debugInfo += `Response status: ${response.status}\n`;
    debugInfo += `Response ok: ${response.ok}\n`;

    console.log('  Response status:', response.status);
    console.log('  Response ok:', response.ok);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      debugInfo += `Error data: ${JSON.stringify(errorData)}\n`;
      console.log('  Error data:', errorData);
      throw new Error(
        `Code search API error: ${response.status} - ${
          errorData.error || response.statusText
        }`
      );
    }

    const data = await response.json();
    debugInfo += `Response data: ${JSON.stringify(data, null, 2)}\n`;
    console.log('  Response data:', JSON.stringify(data, null, 2));

    return {
      success: true,
      results: data.results,
      message: `Found ${data.results.length} code matches for "${query}" in ${repository}\n\nDEBUG INFO:\n${debugInfo}`,
    };
  } catch (error) {
    console.error('Error searching embedded code:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      message: `Code search failed: ${
        error instanceof Error ? error.message : 'Unknown error occurred'
      }`,
    };
  }
};

export const executeGetRepositoryStructure = async (
  { repository, path }: { repository: string; path?: string },
  updateStatus?: (status: string) => void
) => {
  try {
    updateStatus?.('Getting repository structure...');

    // Use the direct GitHub utils approach
    const structure = await githubUtils.getDirectoryStructure(
      repository,
      path || ''
    );

    return {
      success: true,
      structure: structure,
      message: `Retrieved structure for ${repository}${
        path ? ` at path ${path}` : ''
      }`,
    };
  } catch (error) {
    console.error('Error getting repository structure:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};

export const executeRespondToSlackInteraction = async (
  {
    responseUrl,
    text,
    blocks,
    replaceOriginal,
    deleteOriginal,
    responseType,
  }: {
    responseUrl: string;
    text?: string;
    blocks?: any[];
    replaceOriginal?: boolean;
    deleteOriginal?: boolean;
    responseType?: 'ephemeral' | 'in_channel';
  },
  updateStatus?: (status: string) => void
) => {
  try {
    updateStatus?.('Responding to Slack interaction...');

    const payload: any = {};

    if (deleteOriginal) {
      payload.delete_original = true;
    } else {
      if (text) payload.text = text;
      if (blocks) payload.blocks = blocks;
      if (replaceOriginal) payload.replace_original = true;
      if (responseType) payload.response_type = responseType;
    }

    const response = await fetch(responseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return {
      success: true,
      message: 'Successfully responded to Slack interaction',
    };
  } catch (error) {
    console.error('Error responding to Slack interaction:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Failed to respond to Slack interaction',
    };
  }
};

// Advanced GitHub file editing tool execution functions
export const executeInsertAtLine = async (
  {
    path,
    repository,
    branch,
    line,
    content,
    message,
  }: {
    path: string;
    repository: string;
    branch: string;
    line: number;
    content: string;
    message: string;
  },
  updateStatus?: (status: string) => void
) => {
  // Add comprehensive logging
  console.log('🔧 executeInsertAtLine CALLED');
  console.log('Parameters:', {
    path,
    repository,
    branch,
    line,
    content: content.substring(0, 100) + '...',
    message,
  });

  try {
    updateStatus?.(`is inserting content at line ${line} in ${path}...`);
    console.log('📝 About to call FileEditor.insertAtLine');

    await FileEditor.insertAtLine(
      path,
      repository,
      branch,
      line,
      content,
      message
    );

    console.log('✅ FileEditor.insertAtLine completed successfully');

    return {
      success: true,
      message: `Inserted content at line ${line} in ${path}`,
    };
  } catch (error) {
    console.error('❌ Error in executeInsertAtLine:', error);
    throw error;
  }
};

export const executeReplaceLines = async (
  {
    path,
    repository,
    branch,
    startLine,
    endLine,
    content,
    message,
  }: {
    path: string;
    repository: string;
    branch: string;
    startLine: number;
    endLine: number;
    content: string;
    message: string;
  },
  updateStatus?: (status: string) => void
) => {
  // Add comprehensive logging
  console.log('🔧 executeReplaceLines CALLED');
  console.log('Parameters:', {
    path,
    repository,
    branch,
    startLine,
    endLine,
    content: content.substring(0, 100) + '...',
    message,
  });

  // Extract Linear issue ID from branch name for logging
  const issueId = extractLinearIssueFromBranch(branch);
  if (issueId) {
    await logToLinearIssue.info(
      issueId,
      `Replacing lines ${startLine}-${endLine} in ${path}`,
      `Branch: ${branch}, New content: ${content.length} characters`
    );
  }

  try {
    updateStatus?.(`is replacing lines ${startLine}-${endLine} in ${path}...`);
    console.log('📝 About to call FileEditor.replaceLines');

    await FileEditor.replaceLines(
      path,
      repository,
      branch,
      startLine,
      endLine,
      content,
      message
    );

    console.log('✅ FileEditor.replaceLines completed successfully');

    if (issueId) {
      await logToLinearIssue.info(
        issueId,
        `Successfully replaced lines in ${path}`,
        `Lines ${startLine}-${endLine} updated`
      );
    }

    return {
      success: true,
      message: `Replaced lines ${startLine}-${endLine} in ${path}`,
    };
  } catch (error) {
    console.error('❌ Error in executeReplaceLines:', error);

    if (issueId) {
      await logToLinearIssue.error(
        issueId,
        `Failed to replace lines in ${path}`,
        error instanceof Error ? error.message : String(error)
      );
    }

    throw error;
  }
};

export const executeDeleteLines = async (
  {
    path,
    repository,
    branch,
    startLine,
    endLine,
    message,
  }: {
    path: string;
    repository: string;
    branch: string;
    startLine: number;
    endLine: number;
    message: string;
  },
  updateStatus?: (status: string) => void
) => {
  // Add comprehensive logging
  console.log('🔧 executeDeleteLines CALLED');
  console.log('Parameters:', {
    path,
    repository,
    branch,
    startLine,
    endLine,
    message,
  });

  try {
    updateStatus?.(`is deleting lines ${startLine}-${endLine} in ${path}...`);
    console.log('📝 About to call FileEditor.deleteLines');

    await FileEditor.deleteLines(
      path,
      repository,
      branch,
      startLine,
      endLine,
      message
    );

    console.log('✅ FileEditor.deleteLines completed successfully');

    return {
      success: true,
      message: `Deleted lines ${startLine}-${endLine} in ${path}`,
    };
  } catch (error) {
    console.error('❌ Error in executeDeleteLines:', error);
    throw error;
  }
};

export const executeAppendToFile = async (
  {
    path,
    repository,
    branch,
    content,
    message,
  }: {
    path: string;
    repository: string;
    branch: string;
    content: string;
    message: string;
  },
  updateStatus?: (status: string) => void
) => {
  // Add comprehensive logging
  console.log('🔧 executeAppendToFile CALLED');
  console.log('Parameters:', {
    path,
    repository,
    branch,
    content: content.substring(0, 100) + '...',
    message,
  });

  try {
    updateStatus?.(`is appending content to ${path}...`);
    console.log('📝 About to call FileEditor.appendToFile');

    await FileEditor.appendToFile(path, repository, branch, content, message);

    console.log('✅ FileEditor.appendToFile completed successfully');

    return {
      success: true,
      message: `Appended content to ${path}`,
    };
  } catch (error) {
    console.error('❌ Error in executeAppendToFile:', error);
    throw error;
  }
};

export const executePrependToFile = async (
  {
    path,
    repository,
    branch,
    content,
    message,
  }: {
    path: string;
    repository: string;
    branch: string;
    content: string;
    message: string;
  },
  updateStatus?: (status: string) => void
) => {
  // Add comprehensive logging
  console.log('🔧 executePrependToFile CALLED');
  console.log('Parameters:', {
    path,
    repository,
    branch,
    content: content.substring(0, 100) + '...',
    message,
  });

  try {
    updateStatus?.(`is prepending content to ${path}...`);
    console.log('📝 About to call FileEditor.prependToFile');

    await FileEditor.prependToFile(path, repository, branch, content, message);

    console.log('✅ FileEditor.prependToFile completed successfully');

    return {
      success: true,
      message: `Prepended content to ${path}`,
    };
  } catch (error) {
    console.error('❌ Error in executePrependToFile:', error);
    throw error;
  }
};

export const executeFindAndReplace = async (
  {
    path,
    repository,
    branch,
    searchText,
    replaceText,
    message,
    replaceAll,
    caseSensitive,
    wholeWord,
  }: {
    path: string;
    repository: string;
    branch: string;
    searchText: string;
    replaceText: string;
    message: string;
    replaceAll: boolean;
    caseSensitive: boolean;
    wholeWord: boolean;
  },
  updateStatus?: (status: string) => void
) => {
  // Add comprehensive logging
  console.log('🔧 executeFindAndReplace CALLED');
  console.log('Parameters:', {
    path,
    repository,
    branch,
    searchText: searchText.substring(0, 50) + '...',
    replaceText: replaceText.substring(0, 50) + '...',
    message,
    replaceAll,
    caseSensitive,
    wholeWord,
  });

  try {
    updateStatus?.(`is finding and replacing "${searchText}" in ${path}...`);
    console.log('📝 About to call FileEditor.findAndReplace');

    const result = await FileEditor.findAndReplace(
      path,
      repository,
      branch,
      searchText,
      replaceText,
      message,
      {
        replaceAll: replaceAll || false,
        caseSensitive: caseSensitive !== false, // Default to true
        wholeWord: wholeWord || false,
      }
    );

    console.log(
      '✅ FileEditor.findAndReplace completed successfully, replacements:',
      result.replacements
    );

    return {
      success: true,
      replacements: result.replacements,
      message: `Made ${result.replacements} replacement(s) in ${path}`,
    };
  } catch (error) {
    console.error('❌ Error in executeFindAndReplace:', error);
    throw error;
  }
};

export const executeInsertAfterPattern = async (
  {
    path,
    repository,
    branch,
    pattern,
    content,
    message,
    caseSensitive,
    wholeWord,
  }: {
    path: string;
    repository: string;
    branch: string;
    pattern: string;
    content: string;
    message: string;
    caseSensitive: boolean;
    wholeWord: boolean;
  },
  updateStatus?: (status: string) => void
) => {
  // Add comprehensive logging
  console.log('🔧 executeInsertAfterPattern CALLED');
  console.log('Parameters:', {
    path,
    repository,
    branch,
    pattern: pattern.substring(0, 50) + '...',
    content: content.substring(0, 100) + '...',
    message,
    caseSensitive,
    wholeWord,
  });

  try {
    updateStatus?.(
      `is inserting content after pattern "${pattern}" in ${path}...`
    );
    console.log('📝 About to call FileEditor.insertAfterPattern');

    const result = await FileEditor.insertAfterPattern(
      path,
      repository,
      branch,
      pattern,
      content,
      message,
      {
        caseSensitive: caseSensitive !== false, // Default to true
        wholeWord: wholeWord || false,
      }
    );

    console.log(
      '✅ FileEditor.insertAfterPattern completed successfully, result:',
      result
    );

    return {
      success: result.found,
      found: result.found,
      line: result.line,
      message: result.found
        ? `Inserted content after pattern "${pattern}" at line ${result.line} in ${path}`
        : `Pattern "${pattern}" not found in ${path}`,
    };
  } catch (error) {
    console.error('❌ Error in executeInsertAfterPattern:', error);
    throw error;
  }
};

export const executeInsertBeforePattern = async (
  {
    path,
    repository,
    branch,
    pattern,
    content,
    message,
    caseSensitive,
    wholeWord,
  }: {
    path: string;
    repository: string;
    branch: string;
    pattern: string;
    content: string;
    message: string;
    caseSensitive: boolean;
    wholeWord: boolean;
  },
  updateStatus?: (status: string) => void
) => {
  // Add comprehensive logging
  console.log('🔧 executeInsertBeforePattern CALLED');
  console.log('Parameters:', {
    path,
    repository,
    branch,
    pattern: pattern.substring(0, 50) + '...',
    content: content.substring(0, 100) + '...',
    message,
    caseSensitive,
    wholeWord,
  });

  try {
    updateStatus?.(
      `is inserting content before pattern "${pattern}" in ${path}...`
    );
    console.log('📝 About to call FileEditor.insertBeforePattern');

    const result = await FileEditor.insertBeforePattern(
      path,
      repository,
      branch,
      pattern,
      content,
      message,
      {
        caseSensitive: caseSensitive !== false, // Default to true
        wholeWord: wholeWord || false,
      }
    );

    console.log(
      '✅ FileEditor.insertBeforePattern completed successfully, result:',
      result
    );

    return {
      success: result.found,
      found: result.found,
      line: result.line,
      message: result.found
        ? `Inserted content before pattern "${pattern}" at line ${result.line} in ${path}`
        : `Pattern "${pattern}" not found in ${path}`,
    };
  } catch (error) {
    console.error('❌ Error in executeInsertBeforePattern:', error);
    throw error;
  }
};

export const executeApplyMultipleEdits = async (
  {
    path,
    repository,
    branch,
    operations,
    message,
  }: {
    path: string;
    repository: string;
    branch: string;
    operations: Array<{
      type: 'insert' | 'replace' | 'delete';
      line?: number;
      startLine?: number;
      endLine?: number;
      content?: string;
    }>;
    message: string;
  },
  updateStatus?: (status: string) => void
) => {
  // Add comprehensive logging
  console.log('🔧 executeApplyMultipleEdits CALLED');
  console.log('Parameters:', {
    path,
    repository,
    branch,
    operationsCount: operations.length,
    operations: operations.map((op) => ({
      type: op.type,
      line: op.line,
      startLine: op.startLine,
      endLine: op.endLine,
      content: op.content ? op.content.substring(0, 50) + '...' : undefined,
    })),
    message,
  });

  try {
    updateStatus?.(
      `is applying ${operations.length} edit operations to ${path}...`
    );
    console.log(
      '📝 About to convert operations and call FileEditor.applyEdits'
    );

    // Convert operations to the format expected by FileEditor
    const editOperations = operations.map((op) => {
      if (op.type === 'insert') {
        return {
          type: op.type,
          line: op.line,
          content: op.content,
        };
      } else if (op.type === 'replace' || op.type === 'delete') {
        return {
          type: op.type,
          range: {
            start: op.startLine!,
            end: op.endLine!,
          },
          content: op.content,
        };
      }
      throw new Error(`Invalid operation type: ${op.type}`);
    });

    console.log('📝 Converted operations:', editOperations);

    await FileEditor.applyEdits({
      path,
      repository,
      branch,
      operations: editOperations,
      message,
    });

    console.log('✅ FileEditor.applyEdits completed successfully');

    return {
      success: true,
      operationsApplied: operations.length,
      message: `Applied ${operations.length} edit operations to ${path}`,
    };
  } catch (error) {
    console.error('❌ Error in executeApplyMultipleEdits:', error);
    throw error;
  }
};

// Action control tools
export const executeEndActions = async (
  {
    reason,
    summary,
    nextSteps,
  }: {
    reason: string;
    summary: string;
    nextSteps?: string;
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is ending actions: ${reason}`);

  const endMessage = `🛑 **Actions Complete**

**Reason:** ${reason}

**Summary:** ${summary}

${nextSteps ? `**Next Steps:** ${nextSteps}` : ''}

*No further actions will be taken at this time.*`;

  return {
    success: true,
    message: endMessage,
    shouldStop: true, // Signal to stop processing
  };
};

export const executeResetBranchToHead = async (
  {
    repository,
    branch,
    baseBranch,
  }: {
    repository: string;
    branch: string;
    baseBranch?: string;
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is resetting branch ${branch} to head...`);

  try {
    const { resetBranchToHead } = await import('./github/github-utils.js');

    await resetBranchToHead(repository, branch, baseBranch);

    return {
      success: true,
      message: `Successfully reset branch ${branch} to head of ${
        baseBranch || 'default branch'
      }`,
    };
  } catch (error) {
    console.error(`Error resetting branch ${branch}:`, error);
    return {
      success: false,
      message: `Failed to reset branch ${branch}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
};

// Advanced file reading and analysis tools
export const executeReadFileWithContext = async (
  {
    path,
    repository,
    targetLine,
    searchPattern,
    functionName,
    className,
    contextLines,
    maxLines,
    branch,
  }: {
    path: string;
    repository: string;
    targetLine: number;
    searchPattern: string;
    functionName: string;
    className: string;
    contextLines: number;
    maxLines: number;
    branch: string;
  },
  updateStatus?: (status: string) => void
) => {
  try {
    updateStatus?.('Reading file with context...');

    const options: any = {};

    // Handle optional parameters by checking for empty strings and default values
    if (targetLine > 0) options.targetLine = targetLine;
    if (searchPattern && searchPattern.trim())
      options.searchPattern = searchPattern;
    if (functionName && functionName.trim())
      options.functionName = functionName;
    if (className && className.trim()) options.className = className;
    if (contextLines > 0) options.contextLines = contextLines;
    else options.contextLines = 5; // default
    if (maxLines > 0) options.maxLines = maxLines;
    else options.maxLines = 100; // default
    if (branch && branch.trim()) options.branch = branch;

    const result = await advancedFileReader.readFileWithContext(
      path,
      repository,
      options
    );

    const summary = `File: ${path}
Lines ${result.lineNumbers.start}-${result.lineNumbers.end} of ${
      result.lineNumbers.total
    }

Context:
${
  result.beforeLines.length > 0
    ? `Before:\n${result.beforeLines.join('\n')}\n`
    : ''
}
Target:
${result.targetLines.join('\n')}
${
  result.afterLines.length > 0
    ? `\nAfter:\n${result.afterLines.join('\n')}`
    : ''
}`;

    updateStatus?.('File context retrieved successfully');
    return summary;
  } catch (error) {
    const errorMessage = `Failed to read file with context: ${
      error instanceof Error ? error.message : String(error)
    }`;
    updateStatus?.(errorMessage);
    return errorMessage;
  }
};

export const executeAnalyzeFileStructure = async (
  {
    path,
    repository,
    branch,
  }: {
    path: string;
    repository: string;
    branch: string;
  },
  updateStatus?: (status: string) => void
) => {
  try {
    updateStatus?.('Analyzing file structure...');

    const branchToUse = branch && branch.trim() ? branch : undefined;
    const analysis = await advancedFileReader.analyzeFileStructure(
      path,
      repository,
      branchToUse
    );

    const summary = `File Analysis: ${analysis.path}
Language: ${analysis.language}
Total Lines: ${analysis.totalLines}

Functions (${analysis.functions.length}):
${analysis.functions
  .map((f: any) => `  - ${f.name} (lines ${f.startLine}-${f.endLine})`)
  .join('\n')}

Classes (${analysis.classes.length}):
${analysis.classes
  .map((c: any) => `  - ${c.name} (lines ${c.startLine}-${c.endLine})`)
  .join('\n')}

Imports (${analysis.imports.length}):
${analysis.imports
  .map((i: any) => `  - ${i.module} (line ${i.line})`)
  .join('\n')}

Exports (${analysis.exports.length}):
${analysis.exports
  .map((e: any) => `  - ${e.name} (${e.type}, line ${e.line})`)
  .join('\n')}

Dependencies: ${analysis.dependencies.join(', ')}

Complexity:
  - Cyclomatic: ${analysis.complexity.cyclomaticComplexity}
  - Cognitive: ${analysis.complexity.cognitiveComplexity}
  - Maintainability: ${analysis.complexity.maintainabilityIndex}`;

    updateStatus?.('File structure analyzed successfully');
    return summary;
  } catch (error) {
    const errorMessage = `Failed to analyze file structure: ${
      error instanceof Error ? error.message : String(error)
    }`;
    updateStatus?.(errorMessage);
    return errorMessage;
  }
};

export const executeReadRelatedFiles = async (
  {
    mainPath,
    repository,
    includeImports,
    includeTests,
    includeTypes,
    maxFiles,
    branch,
  }: {
    mainPath: string;
    repository: string;
    includeImports: boolean;
    includeTests: boolean;
    includeTypes: boolean;
    maxFiles: number;
    branch: string;
  },
  updateStatus?: (status: string) => void
) => {
  try {
    updateStatus?.('Reading related files...');

    const options: any = {
      includeImports: includeImports,
      includeTests: includeTests,
      includeTypes: includeTypes,
      maxFiles: maxFiles > 0 ? maxFiles : 10, // default to 10
    };

    if (branch && branch.trim()) options.branch = branch;

    const relatedFiles = await advancedFileReader.readRelatedFiles(
      mainPath,
      repository,
      options
    );

    const summary = `Related Files for ${mainPath}:

${relatedFiles
  .map(
    (file: any) => `
${file.relationship}: ${file.path}
${file.content.substring(0, 200)}${file.content.length > 200 ? '...' : ''}
`
  )
  .join('\n---\n')}

Total related files found: ${relatedFiles.length}`;

    updateStatus?.('Related files read successfully');
    return summary;
  } catch (error) {
    const errorMessage = `Failed to read related files: ${
      error instanceof Error ? error.message : String(error)
    }`;
    updateStatus?.(errorMessage);
    return errorMessage;
  }
};

export const executeSearchCodeWithContext = async (
  {
    pattern,
    repository,
    filePattern,
    contextLines,
    maxResults,
    branch,
  }: {
    pattern: string;
    repository: string;
    filePattern: string;
    contextLines: number;
    maxResults: number;
    branch: string;
  },
  updateStatus?: (status: string) => void
) => {
  try {
    updateStatus?.('Searching code with context...');

    const options: any = {
      contextLines: contextLines > 0 ? contextLines : 3, // default to 3
      maxResults: maxResults > 0 ? maxResults : 10, // default to 10
    };

    if (filePattern && filePattern.trim()) options.filePattern = filePattern;
    if (branch && branch.trim()) options.branch = branch;

    const searchResults = await advancedFileReader.searchWithContext(
      pattern,
      repository,
      options
    );

    const summary = `Search Results for "${pattern}":

${searchResults
  .map(
    (file: any) => `
File: ${file.path}
${file.matches
  .map(
    (match: any) => `
  Line ${match.line}: ${match.content}
  Context:
${match.context.map((ctx: any) => `    ${ctx}`).join('\n')}
`
  )
  .join('\n')}
`
  )
  .join('\n---\n')}

Total files with matches: ${searchResults.length}
Total matches: ${searchResults.reduce(
      (sum: number, file: any) => sum + file.matches.length,
      0
    )}`;

    updateStatus?.('Code search completed successfully');
    return summary;
  } catch (error) {
    const errorMessage = `Failed to search code with context: ${
      error instanceof Error ? error.message : String(error)
    }`;
    updateStatus?.(errorMessage);
    return errorMessage;
  }
};
