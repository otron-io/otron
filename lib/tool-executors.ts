import * as linearUtils from './linear/linear-utils.js';
import * as githubUtils from './github/github-utils.js';
import * as slackUtils from './slack/slack-utils.js';
import { LinearClient } from '@linear/sdk';
import { FileEditor } from './github/file-editor.js';
import { advancedFileReader } from './github/file-reader.js';
import { env } from './env.js';
import { agentActivity } from './linear/linear-agent-session-manager.js';

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

  // Add strategic thinking about issue creation
  await agentActivity.thought(
    'system',
    `📋 Issue creation strategy: Creating "${title}" in team ${teamId}${
      parentIssueId ? ` as child of ${parentIssueId}` : ''
    }. Priority: ${priority || 'default'}, Status: ${
      status || 'default'
    }. Description length: ${description.length} chars.`
  );

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
    branch || undefined,
    undefined
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

  // Extract Linear issue ID and add strategic thinking
  const issueId = extractLinearIssueFromBranch(branch);
  if (issueId) {
    await agentActivity.thought(
      issueId,
      `🌿 Branch strategy: Creating '${branch}' from '${
        baseBranch || 'default'
      }' in ${repository}. This will be our working branch for implementing changes.`
    );
  }

  await githubUtils.createBranch(branch, repository, baseBranch || undefined);

  if (issueId) {
    await agentActivity.action(
      issueId,
      'Created branch',
      `${branch} from ${baseBranch || 'default'}`,
      `Branch ready for development in ${repository}`
    );
  }

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
      await agentActivity.thought(
        issueId,
        `💭 File creation strategy: Creating ${path} with ${content.length} characters in ${repository}:${branch}. Commit message: "${message}"`
      );
      await agentActivity.action(
        issueId,
        'Creating file',
        `${path} in ${repository}:${branch}`
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
      await agentActivity.action(
        issueId,
        'Created file',
        `${path} in ${repository}:${branch}`,
        `File created successfully (${content.length} characters)`
      );
    }

    return result;
  } catch (error) {
    const issueId = extractLinearIssueFromBranch(branch);
    if (issueId) {
      await agentActivity.error(
        issueId,
        `Failed to create file ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`
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

  // Extract Linear issue ID and add strategic thinking
  const issueId = extractLinearIssueFromBranch(head);
  if (issueId) {
    await agentActivity.thought(
      issueId,
      `🔄 Pull request strategy: Creating PR to merge '${head}' → '${base}' in ${repository}. Title: "${title}". Body length: ${body.length} chars.`
    );
    await agentActivity.thought(
      issueId,
      `📝 PR content preview: "${body.substring(0, 150)}${
        body.length > 150 ? '...' : ''
      }"`
    );
  }

  const result = await githubUtils.createPullRequest(
    title,
    body,
    head,
    base,
    repository
  );

  if (issueId) {
    await agentActivity.action(
      issueId,
      'Created pull request',
      `#${result.number}: ${title}`,
      `PR ready for review at ${result.url}`
    );
  }

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

export const executeCreateAgentActivity = async (
  {
    sessionId,
    activityType,
    body,
    action,
    parameter,
    result,
  }: {
    sessionId: string;
    activityType: 'thought' | 'elicitation' | 'action' | 'response' | 'error';
    body: string;
    action: string;
    parameter: string;
    result: string;
  },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      success: false,
      error: 'LinearClient is required for Linear operations',
      message: 'Failed to create agent activity: Linear client not available',
    };
  }

  updateStatus?.(`is creating ${activityType} activity...`);

  try {
    // Build the content object based on activity type
    let content: any = { type: activityType };

    switch (activityType) {
      case 'thought':
      case 'elicitation':
      case 'response':
      case 'error':
        if (!body || body.trim() === '') {
          return {
            success: false,
            error: `Body is required for ${activityType} activities`,
            message: `Failed to create ${activityType} activity: Missing body`,
          };
        }
        content.body = body;
        break;

      case 'action':
        if (
          !action ||
          action.trim() === '' ||
          !parameter ||
          parameter.trim() === ''
        ) {
          return {
            success: false,
            error: 'Action and parameter are required for action activities',
            message:
              'Failed to create action activity: Missing action or parameter',
          };
        }
        content.action = action;
        content.parameter = parameter;
        if (result && result.trim() !== '') {
          content.result = result;
        }
        break;
    }

    // Create the agent activity using direct GraphQL mutation
    // Note: Using direct HTTP request since createAgentActivity is not available in SDK version 39.1.1
    const mutation = `
      mutation AgentActivityCreate($input: AgentActivityCreateInput!) {
        agentActivityCreate(input: $input) {
          success
          agentActivity {
            id
          }
        }
      }
    `;

    const variables = {
      input: {
        agentSessionId: sessionId,
        content: content,
      },
    };

    // Use fetch to make direct GraphQL request to Linear API
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${
          (linearClient as any).accessToken || (linearClient as any).token
        }`,
      },
      body: JSON.stringify({
        query: mutation,
        variables: variables,
      }),
    });

    const data = await response.json();

    if (data.data?.agentActivityCreate?.success) {
      return {
        success: true,
        message: `Created ${activityType} activity for session ${sessionId}`,
        activityId: data.data.agentActivityCreate?.agentActivity?.id,
      };
    } else {
      return {
        success: false,
        error: data.errors?.[0]?.message || 'Failed to create agent activity',
        message: `Linear API rejected the ${activityType} activity: ${
          data.errors?.[0]?.message || 'Unknown error'
        }`,
      };
    }
  } catch (error: unknown) {
    console.error(`Error creating agent activity:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      message: `Failed to create ${activityType} activity: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
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

    // Extract Linear issue ID and add strategic thinking
    const issueId = extractLinearIssueFromBranch('current'); // Use current context
    if (issueId) {
      await agentActivity.thought(
        issueId,
        `🔍 Code search strategy: Searching ${repository} for "${query}"${
          fileFilter ? ` in files matching: ${fileFilter}` : ''
        }. Max results: ${maxResults}. This will help understand the codebase structure and locate relevant code.`
      );
    }

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

// Simplified GitHub file editing tool execution functions
export const executeEditCode = async (
  {
    path,
    repository,
    branch,
    oldCode,
    newCode,
    message,
  }: {
    path: string;
    repository: string;
    branch: string;
    oldCode: string;
    newCode: string;
    message: string;
  },
  updateStatus?: (status: string) => void
) => {
  console.log('🔧 executeEditCode CALLED');
  console.log('Parameters:', {
    path,
    repository,
    branch,
    oldCodeLength: oldCode.length,
    newCodeLength: newCode.length,
    message,
  });

  // 🚨 EMERGENCY CIRCUIT BREAKER FOR README.md
  if (path.toLowerCase().includes('readme') && oldCode.length > 200) {
    throw new Error(
      `🚨 EMERGENCY PROTECTION: README.md edits are limited to 200 characters maximum to prevent documentation loss. Your oldCode is ${oldCode.length} characters. Please make smaller, more targeted edits to README files.`
    );
  }

  try {
    updateStatus?.(`is editing code in ${path}...`);

    // Extract Linear issue ID and add strategic thinking logs
    const issueId = extractLinearIssueFromBranch(branch);
    if (issueId) {
      await agentActivity.thought(
        issueId,
        `🧠 Code edit analysis: Modifying ${path} in ${repository}:${branch}. Replacing ${
          oldCode.length
        } chars with ${newCode.length} chars. Change impact: ${
          newCode.length > oldCode.length ? '+' : ''
        }${newCode.length - oldCode.length} characters.`
      );
      await agentActivity.thought(
        issueId,
        `🔍 Edit context: "${oldCode.substring(0, 100)}${
          oldCode.length > 100 ? '...' : ''
        }" → "${newCode.substring(0, 100)}${
          newCode.length > 100 ? '...' : ''
        }" | Commit: "${message}"`
      );
    }

    // CRITICAL SAFETY CHECKS

    // 1. Prevent massive deletions
    if (oldCode.length > 1000) {
      throw new Error(
        `SAFETY CHECK FAILED: oldCode is too large (${oldCode.length} characters). For safety, this tool only allows replacing content up to 1000 characters. Please use smaller, more specific code blocks.`
      );
    }

    // 2. Prevent replacing more than 50 lines
    const oldCodeLines = oldCode.split('\n').length;
    if (oldCodeLines > 50) {
      throw new Error(
        `SAFETY CHECK FAILED: oldCode contains ${oldCodeLines} lines. For safety, this tool only allows replacing up to 50 lines at once. Please use smaller, more specific code blocks.`
      );
    }

    // 3. Check for suspicious patterns that might indicate accidental large matches
    const suspiciousPatterns = [
      /```[\s\S]*```/, // Code blocks
      /#{2,}/, // Multiple headers
      /\n\s*\n\s*\n/, // Multiple blank lines
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(oldCode)) {
        console.warn(
          '⚠️ WARNING: oldCode contains patterns that might indicate a large text block'
        );
      }
    }

    // Get the current file content
    const { getFileContent } = await import('./github/github-utils.js');
    const currentContent = await getFileContent(
      path,
      repository,
      1,
      10000,
      branch,
      undefined
    );

    // Remove any header line that getFileContent might add
    const lines = currentContent.split('\n');
    let content = currentContent;
    if (lines.length > 0 && lines[0]?.match(/^\/\/ Lines \d+-\d+ of \d+$/)) {
      content = lines.slice(1).join('\n');
    }

    // Multi-strategy code matching with detailed debugging
    let matchInfo: {
      strategy: string;
      exact: boolean;
      originalCode?: string;
      startIndex?: number;
      endIndex?: number;
    } | null = null;

    // Strategy 1: Exact match
    if (content.includes(oldCode)) {
      matchInfo = { strategy: 'exact', exact: true };
      console.log('✅ Using exact matching for editCode');
    }
    // Strategy 2: Normalize line endings and try again
    else {
      const normalizedContent = content
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
      const normalizedOldCode = oldCode
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');

      if (normalizedContent.includes(normalizedOldCode)) {
        matchInfo = { strategy: 'line-endings', exact: true };
        console.log('⚠️ Using line-ending normalized matching for editCode');
      }
      // Strategy 3: Normalize whitespace (spaces/tabs)
      else {
        const whitespaceNormalizedContent = normalizedContent.replace(
          /\t/g,
          '  '
        );
        const whitespaceNormalizedOldCode = normalizedOldCode.replace(
          /\t/g,
          '  '
        );

        if (whitespaceNormalizedContent.includes(whitespaceNormalizedOldCode)) {
          matchInfo = { strategy: 'whitespace', exact: true };
          console.log('⚠️ Using whitespace-normalized matching for editCode');
        }
        // Strategy 4: Aggressive whitespace normalization with fuzzy boundary detection
        else {
          const aggressiveContent = normalizedContent
            .replace(/\s+/g, ' ')
            .trim();
          const aggressiveOldCode = normalizedOldCode
            .replace(/\s+/g, ' ')
            .trim();

          if (aggressiveContent.includes(aggressiveOldCode)) {
            // Find the position in the normalized aggressive content
            const normalizedIndex =
              aggressiveContent.indexOf(aggressiveOldCode);

            // Map back to original content boundaries using a simple approach
            // Count characters before the match, accounting for whitespace differences
            let actualStartIndex = 0;
            let normalizedCount = 0;

            for (
              let i = 0;
              i < normalizedContent.length && normalizedCount < normalizedIndex;
              i++
            ) {
              const char = normalizedContent[i];
              if (/\s/.test(char)) {
                // Skip multiple consecutive whitespace in original
                while (
                  i < normalizedContent.length &&
                  /\s/.test(normalizedContent[i])
                ) {
                  i++;
                }
                i--; // Adjust for the increment in the for loop
                normalizedCount++; // Count as one space in normalized version
              } else {
                normalizedCount++;
              }
              actualStartIndex = i + 1;
            }

            // Estimate end position by finding content that would normalize to our target
            let actualEndIndex = actualStartIndex;
            let matchedNormalizedLength = 0;

            for (
              let i = actualStartIndex;
              i < normalizedContent.length &&
              matchedNormalizedLength < aggressiveOldCode.length;
              i++
            ) {
              const char = normalizedContent[i];
              if (/\s/.test(char)) {
                // Skip multiple consecutive whitespace
                while (
                  i < normalizedContent.length &&
                  /\s/.test(normalizedContent[i])
                ) {
                  i++;
                }
                i--; // Adjust for the increment
                matchedNormalizedLength++; // Count as one space
              } else {
                matchedNormalizedLength++;
              }
              actualEndIndex = i + 1;
            }

            matchInfo = {
              strategy: 'aggressive-whitespace',
              exact: false,
              originalCode: normalizedContent.slice(
                actualStartIndex,
                actualEndIndex
              ),
              startIndex: actualStartIndex,
              endIndex: actualEndIndex,
            };
            console.log('⚠️ Using aggressive whitespace matching for editCode');
          }
        }
      }
    }

    // If no match found, provide comprehensive debugging
    if (!matchInfo) {
      console.error('❌ EditCode matching failed. Comprehensive debugging:');
      console.error('='.repeat(80));
      console.error('File path:', path);
      console.error('Repository:', repository);
      console.error('Branch:', branch);
      console.error('Old code length:', oldCode.length);
      console.error('File content length:', content.length);

      // Character-by-character analysis of differences
      console.error('\n📝 OLD CODE (first 300 chars):');
      console.error(JSON.stringify(oldCode.substring(0, 300)));
      console.error('\n📄 FILE CONTENT (first 300 chars):');
      console.error(JSON.stringify(content.substring(0, 300)));

      // Line-by-line comparison
      const oldCodeLines = oldCode.split('\n');
      const contentLines = content.split('\n');

      console.error('\n📊 Line comparison:');
      console.error(`Old code lines: ${oldCodeLines.length}`);
      console.error(`File content lines: ${contentLines.length}`);

      // Check for common issues
      console.error('\n🔍 Common issues check:');
      console.error(
        `Old code starts with BOM: ${oldCode.charCodeAt(0) === 0xfeff}`
      );
      console.error(
        `File content starts with BOM: ${content.charCodeAt(0) === 0xfeff}`
      );
      console.error(`Old code has \\r\\n: ${oldCode.includes('\\r\\n')}`);
      console.error(`File content has \\r\\n: ${content.includes('\\r\\n')}`);
      console.error(`Old code has tabs: ${oldCode.includes('\\t')}`);
      console.error(`File content has tabs: ${content.includes('\\t')}`);

      // Check if old code looks like formatted readFileWithContext output
      const hasFileHeader =
        oldCode.startsWith('File: ') || oldCode.includes('Lines ');
      const hasContextHeaders =
        oldCode.includes('Context:') ||
        oldCode.includes('Before:') ||
        oldCode.includes('Target:');

      if (hasFileHeader || hasContextHeaders) {
        console.error('\n⚠️  POTENTIAL ISSUE DETECTED:');
        console.error(
          'Old code appears to be formatted output from readFileWithContext tool!'
        );
        console.error(
          'This suggests the agent is using formatted context as oldCode instead of raw code.'
        );

        throw new Error(
          `❌ AGENT ERROR: The oldCode parameter appears to be formatted output from readFileWithContext tool, not raw source code. The agent should extract the actual code content, not use the formatted summary. Please use the raw source code that needs to be replaced.`
        );
      }

      // Find the closest matching lines
      const firstLine = oldCodeLines[0]?.trim();
      const lastLine = oldCodeLines[oldCodeLines.length - 1]?.trim();

      const firstLineMatch = firstLine
        ? contentLines.findIndex((line) => line.trim().includes(firstLine))
        : -1;
      const lastLineMatch = lastLine
        ? contentLines.findIndex((line) => line.trim().includes(lastLine))
        : -1;

      console.error('\n🎯 Pattern matching results:');
      console.error(`First line "${firstLine}" found at: ${firstLineMatch}`);
      console.error(`Last line "${lastLine}" found at: ${lastLineMatch}`);

      if (firstLineMatch !== -1) {
        if (lastLineMatch !== -1) {
          // Show the actual content around the matches
          console.error(
            `\n📍 Content around first match (line ${firstLineMatch + 1}):`
          );
          const start = Math.max(0, firstLineMatch - 2);
          const end = Math.min(contentLines.length, firstLineMatch + 3);
          for (let i = start; i < end; i++) {
            const marker = i === firstLineMatch ? '➤ ' : '  ';
            console.error(`${marker}${i + 1}: ${contentLines[i]}`);
          }

          console.error(
            `\n📍 Content around last match (line ${lastLineMatch + 1}):`
          );
          const lastStart = Math.max(0, lastLineMatch - 2);
          const lastEnd = Math.min(contentLines.length, lastLineMatch + 3);
          for (let i = lastStart; i < lastEnd; i++) {
            const marker = i === lastLineMatch ? '➤ ' : '  ';
            console.error(`${marker}${i + 1}: ${contentLines[i]}`);
          }

          throw new Error(
            `Code pattern found but exact match failed in ${path}. Found first line at ${
              firstLineMatch + 1
            } and last line at ${
              lastLineMatch + 1
            }. The content exists but formatting differs. Check the detailed debugging output above for character-level differences.`
          );
        } else {
          throw new Error(
            `Partial code match found in ${path}. Found first line "${firstLine}" at line ${
              firstLineMatch + 1
            } but couldn't locate the full block. Try using a smaller, more specific code chunk.`
          );
        }
      }

      console.error('='.repeat(80));
      throw new Error(
        `Old code not found in ${path}. The file content may have changed since you last read it. Check the comprehensive debugging output above for details.`
      );
    }

    // Perform replacement based on the matching strategy
    let afterReplacement: string;
    let occurrences: number;
    let replacedCode: string;

    if (matchInfo.exact) {
      // For exact and normalized matches, use a simplified approach
      if (matchInfo.strategy === 'exact') {
        // Simple exact replacement
        occurrences = content.split(oldCode).length - 1;
        if (occurrences > 1) {
          throw new Error(
            `Old code appears ${occurrences} times in ${path}. Please provide more specific code to avoid ambiguity.`
          );
        }
        afterReplacement = content.replace(oldCode, newCode);
        replacedCode = oldCode;
      } else {
        // For normalized matches, apply normalization and then replace
        let normalizedContent = content;
        let normalizedOldCode = oldCode;

        if (matchInfo.strategy === 'line-endings') {
          normalizedContent = content
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n');
          normalizedOldCode = oldCode
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n');
        } else if (matchInfo.strategy === 'whitespace') {
          normalizedContent = content
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/\t/g, '  ');
          normalizedOldCode = oldCode
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/\t/g, '  ');
        }

        // Check for multiple occurrences in normalized content
        occurrences = normalizedContent.split(normalizedOldCode).length - 1;
        if (occurrences > 1) {
          throw new Error(
            `Old code appears ${occurrences} times in ${path} after normalization. Please provide more specific code to avoid ambiguity.`
          );
        }

        // Replace in normalized content, then use the result
        afterReplacement = normalizedContent.replace(
          normalizedOldCode,
          newCode
        );
        replacedCode = normalizedOldCode;

        console.log('📝 Using normalized matching - applied replacement:', {
          strategy: matchInfo.strategy,
          replacedLength: normalizedOldCode.length,
          newLength: newCode.length,
        });
      }
    } else {
      // For fuzzy matches, use the detected boundaries
      if (
        matchInfo.startIndex === undefined ||
        matchInfo.endIndex === undefined ||
        !matchInfo.originalCode
      ) {
        throw new Error(`Invalid fuzzy match data for ${path}`);
      }

      replacedCode = matchInfo.originalCode;
      afterReplacement =
        content.slice(0, matchInfo.startIndex) +
        newCode +
        content.slice(matchInfo.endIndex);
      occurrences = 1;

      console.log('📝 Using fuzzy matching - replaced exact content:', {
        strategy: matchInfo.strategy,
        originalLength: matchInfo.originalCode.length,
        newLength: newCode.length,
        replacedPreview:
          replacedCode.substring(0, 50) +
          (replacedCode.length > 50 ? '...' : ''),
      });
    }

    // CRITICAL: Validate the replacement will not cause massive deletions
    const originalLength = content.length;
    const newLength = afterReplacement.length;
    const deletionRatio = (originalLength - newLength) / originalLength;

    if (deletionRatio > 0.1) {
      // More than 10% deletion
      throw new Error(
        `SAFETY CHECK FAILED: This replacement would delete ${Math.round(
          deletionRatio * 100
        )}% of the file content (${
          originalLength - newLength
        } characters). This seems like an unintended large deletion. Please verify your oldCode parameter is correct and specific.`
      );
    }

    if (Math.abs(originalLength - newLength) > 2000) {
      // Change more than 2000 characters
      throw new Error(
        `SAFETY CHECK FAILED: This replacement would change ${Math.abs(
          originalLength - newLength
        )} characters, which is more than the safety limit of 2000. Please use smaller, more targeted edits.`
      );
    }

    // 🚨 ADDITIONAL EMERGENCY CHECK FOR DOCUMENTATION FILES
    if (
      path.toLowerCase().includes('readme') ||
      path.toLowerCase().includes('.md')
    ) {
      if (Math.abs(originalLength - newLength) > 500) {
        throw new Error(
          `🚨 DOCUMENTATION PROTECTION: This would change ${Math.abs(
            originalLength - newLength
          )} characters in a documentation file. For safety, documentation edits are limited to 500 character changes maximum.`
        );
      }
    }

    // Log the change details for debugging
    console.log('📊 Edit summary:', {
      strategy: matchInfo.strategy,
      originalLength,
      newLength,
      difference: newLength - originalLength,
      deletionRatio: Math.round(deletionRatio * 100) + '%',
      replacedCodePreview:
        replacedCode.substring(0, 100) +
        (replacedCode.length > 100 ? '...' : ''),
      newCodePreview:
        newCode.substring(0, 100) + (newCode.length > 100 ? '...' : ''),
    });

    // Replace the old code with the new code
    const updatedContent = afterReplacement;

    // Update the file
    const { createOrUpdateFile } = await import('./github/github-utils.js');
    await createOrUpdateFile(path, updatedContent, message, repository, branch);

    console.log('✅ executeEditCode completed successfully');

    return {
      success: true,
      message: `Successfully replaced code in ${path} using ${matchInfo.strategy} matching (${replacedCode.length} → ${newCode.length} characters)`,
    };
  } catch (error) {
    console.error('❌ Error in executeEditCode:', error);
    throw error;
  }
};

export const executeAddCode = async (
  {
    path,
    repository,
    branch,
    newCode,
    position,
    context,
    message,
  }: {
    path: string;
    repository: string;
    branch: string;
    newCode: string;
    position: 'start' | 'end' | 'after' | 'before';
    context: string;
    message: string;
  },
  updateStatus?: (status: string) => void
) => {
  console.log('🔧 executeAddCode CALLED');
  console.log('Parameters:', {
    path,
    repository,
    branch,
    newCodeLength: newCode.length,
    position,
    contextLength: context.length,
    message,
  });

  try {
    updateStatus?.(`is adding code to ${path}...`);

    // SAFETY CHECKS
    if (newCode.length > 2000) {
      throw new Error(
        `SAFETY CHECK FAILED: newCode is too large (${newCode.length} characters). For safety, this tool only allows adding up to 2000 characters at once.`
      );
    }

    const newCodeLines = newCode.split('\n').length;
    if (newCodeLines > 100) {
      throw new Error(
        `SAFETY CHECK FAILED: newCode contains ${newCodeLines} lines. For safety, this tool only allows adding up to 100 lines at once.`
      );
    }

    // Get the current file content
    const { getFileContent } = await import('./github/github-utils.js');
    const currentContent = await getFileContent(
      path,
      repository,
      1,
      10000,
      branch,
      undefined
    );

    // Remove any header line that getFileContent might add
    const lines = currentContent.split('\n');
    let content = currentContent;
    if (lines.length > 0 && lines[0]?.match(/^\/\/ Lines \d+-\d+ of \d+$/)) {
      content = lines.slice(1).join('\n');
    }

    let updatedContent: string;

    switch (position) {
      case 'start':
        updatedContent = newCode + '\n' + content;
        break;

      case 'end':
        updatedContent = content + '\n' + newCode;
        break;

      case 'after':
        if (!context) {
          throw new Error('Context is required when position is "after"');
        }

        // SAFETY CHECK: Validate context size
        if (context.length > 1000) {
          throw new Error(
            `SAFETY CHECK FAILED: context is too large (${context.length} characters). Please use a smaller, more specific context.`
          );
        }

        if (!content.includes(context)) {
          throw new Error(
            `Context not found in ${path}: ${context.substring(0, 100)}...`
          );
        }
        const afterOccurrences = content.split(context).length - 1;
        if (afterOccurrences > 1) {
          throw new Error(
            `Context appears ${afterOccurrences} times in ${path}. Please provide more specific context.`
          );
        }
        updatedContent = content.replace(context, context + '\n' + newCode);
        break;

      case 'before':
        if (!context) {
          throw new Error('Context is required when position is "before"');
        }

        // SAFETY CHECK: Validate context size
        if (context.length > 1000) {
          throw new Error(
            `SAFETY CHECK FAILED: context is too large (${context.length} characters). Please use a smaller, more specific context.`
          );
        }

        if (!content.includes(context)) {
          throw new Error(
            `Context not found in ${path}: ${context.substring(0, 100)}...`
          );
        }
        const beforeOccurrences = content.split(context).length - 1;
        if (beforeOccurrences > 1) {
          throw new Error(
            `Context appears ${beforeOccurrences} times in ${path}. Please provide more specific context.`
          );
        }
        updatedContent = content.replace(context, newCode + '\n' + context);
        break;

      default:
        throw new Error(`Invalid position: ${position}`);
    }

    // SAFETY CHECK: Validate file size increase is reasonable
    const originalLength = content.length;
    const newLength = updatedContent.length;
    const increase = newLength - originalLength;

    if (increase > 5000) {
      throw new Error(
        `SAFETY CHECK FAILED: This would increase the file size by ${increase} characters, which exceeds the safety limit of 5000. Please add smaller chunks.`
      );
    }

    console.log('📊 Add code summary:', {
      originalLength,
      newLength,
      increase,
      newCodePreview:
        newCode.substring(0, 100) + (newCode.length > 100 ? '...' : ''),
      position,
      contextPreview: context
        ? context.substring(0, 50) + (context.length > 50 ? '...' : '')
        : 'N/A',
    });

    // Update the file
    const { createOrUpdateFile } = await import('./github/github-utils.js');
    await createOrUpdateFile(path, updatedContent, message, repository, branch);

    console.log('✅ executeAddCode completed successfully');

    return {
      success: true,
      message: `Successfully added code to ${path} (${position}${
        context ? ' context' : ''
      }) - ${increase} characters added`,
    };
  } catch (error) {
    console.error('❌ Error in executeAddCode:', error);
    throw error;
  }
};

export const executeRemoveCode = async (
  {
    path,
    repository,
    branch,
    codeToRemove,
    message,
  }: {
    path: string;
    repository: string;
    branch: string;
    codeToRemove: string;
    message: string;
  },
  updateStatus?: (status: string) => void
) => {
  console.log('🔧 executeRemoveCode CALLED');
  console.log('Parameters:', {
    path,
    repository,
    branch,
    codeToRemoveLength: codeToRemove.length,
    message,
  });

  try {
    updateStatus?.(`is removing code from ${path}...`);

    // CRITICAL SAFETY CHECKS
    if (codeToRemove.length > 1000) {
      throw new Error(
        `SAFETY CHECK FAILED: codeToRemove is too large (${codeToRemove.length} characters). For safety, this tool only allows removing up to 1000 characters at once.`
      );
    }

    const codeToRemoveLines = codeToRemove.split('\n').length;
    if (codeToRemoveLines > 50) {
      throw new Error(
        `SAFETY CHECK FAILED: codeToRemove contains ${codeToRemoveLines} lines. For safety, this tool only allows removing up to 50 lines at once.`
      );
    }

    // Get the current file content
    const { getFileContent } = await import('./github/github-utils.js');
    const currentContent = await getFileContent(
      path,
      repository,
      1,
      10000,
      branch,
      undefined
    );

    // Remove any header line that getFileContent might add
    const lines = currentContent.split('\n');
    let content = currentContent;
    if (lines.length > 0 && lines[0]?.match(/^\/\/ Lines \d+-\d+ of \d+$/)) {
      content = lines.slice(1).join('\n');
    }

    // Check if the code to remove exists in the file
    if (!content.includes(codeToRemove)) {
      throw new Error(
        `Code to remove not found in ${path}. The file content may have changed since you last read it.`
      );
    }

    // Check if the code appears multiple times
    const occurrences = content.split(codeToRemove).length - 1;
    if (occurrences > 1) {
      throw new Error(
        `Code to remove appears ${occurrences} times in ${path}. Please provide more specific code to avoid ambiguity.`
      );
    }

    // CRITICAL: Validate the removal will not cause massive deletions
    const originalLength = content.length;
    const afterRemoval = content.replace(codeToRemove, '');
    const newLength = afterRemoval.length;
    const deletionRatio = (originalLength - newLength) / originalLength;

    if (deletionRatio > 0.1) {
      // More than 10% deletion
      throw new Error(
        `SAFETY CHECK FAILED: This removal would delete ${Math.round(
          deletionRatio * 100
        )}% of the file content (${
          originalLength - newLength
        } characters). This seems like an unintended large deletion. Please verify your codeToRemove parameter is correct and specific.`
      );
    }

    console.log('📊 Remove code summary:', {
      originalLength,
      newLength,
      deleted: originalLength - newLength,
      deletionRatio: Math.round(deletionRatio * 100) + '%',
      codeToRemovePreview:
        codeToRemove.substring(0, 100) +
        (codeToRemove.length > 100 ? '...' : ''),
    });

    // Remove the code
    const updatedContent = afterRemoval;

    // Update the file
    const { createOrUpdateFile } = await import('./github/github-utils.js');
    await createOrUpdateFile(path, updatedContent, message, repository, branch);

    console.log('✅ executeRemoveCode completed successfully');

    return {
      success: true,
      message: `Successfully removed code from ${path} (${codeToRemove.length} characters removed)`,
    };
  } catch (error) {
    console.error('❌ Error in executeRemoveCode:', error);
    throw error;
  }
};

// 🚨 ULTRA-SAFE URL EDITING TOOL FOR DOCUMENTATION
export const executeEditUrl = async (
  {
    path,
    repository,
    branch,
    oldUrl,
    newUrl,
    message,
  }: {
    path: string;
    repository: string;
    branch: string;
    oldUrl: string;
    newUrl: string;
    message: string;
  },
  updateStatus?: (status: string) => void
) => {
  console.log('🔧 executeEditUrl CALLED');
  console.log('Parameters:', {
    path,
    repository,
    branch,
    oldUrlLength: oldUrl.length,
    newUrlLength: newUrl.length,
    message,
  });

  try {
    updateStatus?.(`is editing URL in ${path}...`);

    // 🚨 ULTRA-STRICT SAFETY CHECKS FOR URL EDITING

    // 1. Only allow URL-like content
    if (!oldUrl.includes('http://') && !oldUrl.includes('https://')) {
      throw new Error(
        `SAFETY CHECK FAILED: oldUrl must contain http:// or https:// to be recognized as a URL. Got: ${oldUrl.substring(
          0,
          100
        )}...`
      );
    }

    if (!newUrl.includes('http://') && !newUrl.includes('https://')) {
      throw new Error(
        `SAFETY CHECK FAILED: newUrl must contain http:// or https:// to be recognized as a URL. Got: ${newUrl.substring(
          0,
          100
        )}...`
      );
    }

    // 2. Prevent large URL blocks (should be single line URLs)
    if (oldUrl.length > 2000) {
      throw new Error(
        `SAFETY CHECK FAILED: oldUrl is too large (${oldUrl.length} characters). URLs should typically be under 2000 characters.`
      );
    }

    if (newUrl.length > 2000) {
      throw new Error(
        `SAFETY CHECK FAILED: newUrl is too large (${newUrl.length} characters). URLs should typically be under 2000 characters.`
      );
    }

    // 3. Prevent multi-line URLs (which might indicate accidental large matches)
    const oldUrlLines = oldUrl.split('\n').length;
    if (oldUrlLines > 3) {
      throw new Error(
        `SAFETY CHECK FAILED: oldUrl contains ${oldUrlLines} lines. For safety, URL edits should be 1-3 lines maximum.`
      );
    }

    // Get the current file content
    const { getFileContent } = await import('./github/github-utils.js');
    const currentContent = await getFileContent(
      path,
      repository,
      1,
      10000,
      branch,
      undefined
    );

    // Remove any header line that getFileContent might add
    const lines = currentContent.split('\n');
    let content = currentContent;
    if (lines.length > 0 && lines[0]?.match(/^\/\/ Lines \d+-\d+ of \d+$/)) {
      content = lines.slice(1).join('\n');
    }

    // Check if the old URL exists in the file
    if (!content.includes(oldUrl)) {
      throw new Error(
        `Old URL not found in ${path}. The file content may have changed since you last read it. Looking for: ${oldUrl.substring(
          0,
          200
        )}...`
      );
    }

    // Check if the old URL appears multiple times
    const occurrences = content.split(oldUrl).length - 1;
    if (occurrences > 1) {
      throw new Error(
        `Old URL appears ${occurrences} times in ${path}. Please provide more specific URL text to avoid ambiguity.`
      );
    }

    // 🚨 CRITICAL: Validate the replacement will cause minimal change
    const originalLength = content.length;
    const afterReplacement = content.replace(oldUrl, newUrl);
    const newLength = afterReplacement.length;
    const difference = Math.abs(originalLength - newLength);

    // For URL edits, the difference should be small (typically just added/removed parameters)
    if (difference > 1000) {
      throw new Error(
        `🚨 URL EDIT SAFETY CHECK FAILED: This URL replacement would change ${difference} characters in the file. URL edits should typically change less than 1000 characters. This suggests the oldUrl parameter might be matching more content than intended.`
      );
    }

    // Log the change details for debugging
    console.log('📊 URL edit summary:', {
      originalLength,
      newLength,
      difference,
      oldUrlPreview:
        oldUrl.substring(0, 150) + (oldUrl.length > 150 ? '...' : ''),
      newUrlPreview:
        newUrl.substring(0, 150) + (newUrl.length > 150 ? '...' : ''),
    });

    // Replace the old URL with the new URL
    const updatedContent = afterReplacement;

    // Update the file
    const { createOrUpdateFile } = await import('./github/github-utils.js');
    await createOrUpdateFile(path, updatedContent, message, repository, branch);

    console.log('✅ executeEditUrl completed successfully');

    return {
      success: true,
      message: `Successfully updated URL in ${path} (${difference} character difference)`,
    };
  } catch (error) {
    console.error('❌ Error in executeEditUrl:', error);
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

// Simplified file reading tool

export const executeGetRawFileContent = async (
  {
    path,
    repository,
    startLine,
    endLine,
    branch,
    sessionId,
  }: {
    path: string;
    repository: string;
    startLine: number;
    endLine: number;
    branch: string;
    sessionId?: string;
  },
  updateStatus?: (status: string) => void
) => {
  try {
    // Validate and normalize line parameters
    if (!startLine || startLine < 1) startLine = 1;
    const normalizedEndLine = !endLine || endLine === 0 ? undefined : endLine;

    updateStatus?.(
      `Getting raw content of ${path} (lines ${startLine}${
        normalizedEndLine ? `-${normalizedEndLine}` : '+'
      })`
    );

    // Get the raw file content without any formatting
    const { getFileContent } = await import('./github/github-utils.js');
    const fullContent = await getFileContent(
      path,
      repository,
      1,
      10000, // Get full file to determine total lines
      branch || undefined,
      sessionId
    );

    // Remove any header line that getFileContent might add
    const lines = fullContent.split('\n');
    let allLines = lines;

    // Check if first line is the line info header from getFileContent
    if (lines.length > 0 && lines[0]?.match(/^\/\/ Lines \d+-\d+ of \d+$/)) {
      allLines = lines.slice(1);
    }

    const totalLines = allLines.length;

    // Check if startLine is beyond the file
    if (startLine > totalLines) {
      return {
        content: '',
        startLine,
        endLine: startLine,
        totalLines,
        message: `Start line ${startLine} is beyond file end (${totalLines} lines). File has no content at requested range.`,
      };
    }

    // Calculate actual end line
    let actualEndLine: number;
    if (normalizedEndLine) {
      // User specified an end line
      actualEndLine = Math.min(normalizedEndLine, totalLines);
      // Ensure we don't exceed 200 lines
      if (actualEndLine - startLine + 1 > 200) {
        actualEndLine = startLine + 199;
      }
    } else {
      // No end line specified, read up to 200 lines or end of file
      actualEndLine = Math.min(startLine + 199, totalLines);
    }

    // Ensure endLine >= startLine
    if (actualEndLine < startLine) {
      actualEndLine = startLine;
    }

    // Extract the requested range (slice uses 0-based indexing)
    const requestedLines = allLines.slice(startLine - 1, actualEndLine);
    const rawContent = requestedLines.join('\n');

    // Extract Linear issue ID from sessionId or repository for activity logging
    const issueId =
      extractLinearIssueFromBranch(branch || '') ||
      sessionId?.match(/[A-Z]{2,}-\d+/)?.[0];

    if (issueId) {
      await agentActivity.thought(
        issueId,
        `📄 Reading file content from \`${path}\` in \`${repository}\`${
          branch && branch.trim() ? ` (branch: ${branch})` : ''
        }`
      );

      // Get proper file extension for syntax highlighting
      const getFileExtension = (filePath: string): string => {
        const ext = filePath.split('.').pop()?.toLowerCase();
        const extensionMap: { [key: string]: string } = {
          ts: 'typescript',
          tsx: 'typescript',
          js: 'javascript',
          jsx: 'javascript',
          py: 'python',
          java: 'java',
          cpp: 'cpp',
          c: 'c',
          h: 'c',
          cs: 'csharp',
          php: 'php',
          rb: 'ruby',
          go: 'go',
          rs: 'rust',
          swift: 'swift',
          kt: 'kotlin',
          dart: 'dart',
          html: 'html',
          css: 'css',
          scss: 'scss',
          sass: 'sass',
          less: 'less',
          json: 'json',
          xml: 'xml',
          yaml: 'yaml',
          yml: 'yaml',
          md: 'markdown',
          sh: 'bash',
          bash: 'bash',
          zsh: 'bash',
          fish: 'bash',
          ps1: 'powershell',
          sql: 'sql',
          graphql: 'graphql',
          gql: 'graphql',
          dockerfile: 'dockerfile',
          toml: 'toml',
          ini: 'ini',
        };
        return extensionMap[ext || ''] || 'text';
      };

      // Create detailed markdown content with proper syntax highlighting
      const markdownContent = `## 📄 File Content: \`${path}\`

**Repository:** \`${repository}\`${
        branch && branch.trim()
          ? `  
**Branch:** \`${branch}\``
          : ''
      }  
**Lines:** ${startLine}-${actualEndLine} of ${totalLines}  
**Size:** ${rawContent.length} characters  
**Range:** ${actualEndLine - startLine + 1} lines returned

\`\`\`${getFileExtension(path)}
${rawContent}
\`\`\``;

      await agentActivity.thought(issueId, markdownContent);
    }

    updateStatus?.('Raw file content retrieved successfully');

    // Debug logging for range issues
    console.log(`📊 getRawFileContent range calculation:`, {
      requestedStart: startLine,
      requestedEnd: normalizedEndLine || 'auto',
      actualStart: startLine,
      actualEnd: actualEndLine,
      totalLines,
      linesReturned: actualEndLine - startLine + 1,
      contentLength: rawContent.length,
    });

    return {
      content: rawContent,
      startLine,
      endLine: actualEndLine,
      totalLines,
      message: `Retrieved lines ${startLine}-${actualEndLine} from ${path} (${
        actualEndLine - startLine + 1
      } lines, ${rawContent.length} characters)`,
    };
  } catch (error) {
    const errorMessage = `Failed to get raw file content: ${
      error instanceof Error ? error.message : String(error)
    }`;
    updateStatus?.(errorMessage);
    throw new Error(errorMessage);
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
