import { exa } from './utils.js';
import * as linearUtils from './linear/linear-utils.js';
import * as githubUtils from './github/github-utils.js';
import * as slackUtils from './slack/slack-utils.js';
import { LinearClient } from '@linear/sdk';

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

export const executeSearchWeb = async (
  { query }: { query: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is searching the web for ${query}...`);
  const { results } = await exa.searchAndContents(query, {
    livecrawl: 'always',
    numResults: 3,
  });

  return {
    results: results.map((result: any) => ({
      title: result.title,
      url: result.url,
      snippet: result.text.slice(0, 1000),
    })),
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
    throw new Error('LinearClient is required for Linear operations');
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
    throw new Error('LinearClient is required for Linear operations');
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
    throw new Error('LinearClient is required for Linear operations');
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
    throw new Error('LinearClient is required for Linear operations');
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
    throw new Error('LinearClient is required for Linear operations');
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
    throw new Error('LinearClient is required for Linear operations');
  }

  updateStatus?.(`is creating new issue "${title}"...`);

  await linearUtils.createIssue(
    linearClient,
    teamId,
    title,
    description,
    status || undefined,
    priority === 0 ? undefined : priority,
    parentIssueId || undefined
  );
  return {
    success: true,
    message: `Created new issue "${title}"`,
  };
};

export const executeAddIssueAttachment = async (
  { issueId, url, title }: { issueId: string; url: string; title: string },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    throw new Error('LinearClient is required for Linear operations');
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
    throw new Error('LinearClient is required for Linear operations');
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
    throw new Error('LinearClient is required for Linear operations');
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

export const executeCreateOrUpdateFile = async (
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
  updateStatus?.(`is updating file ${path} in ${repository}/${branch}...`);

  await githubUtils.createOrUpdateFile(
    path,
    content,
    message,
    repository,
    branch
  );
  return {
    success: true,
    message: `Updated file ${path} in ${repository}/${branch}`,
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
  updateStatus?.(`is getting directory structure for ${repository}...`);

  const structure = await githubUtils.getDirectoryStructure(
    repository,
    directoryPath || ''
  );
  return { structure };
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
    throw new Error('LinearClient is required for Linear operations');
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
