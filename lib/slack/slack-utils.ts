import { WebClient } from '@slack/web-api';
import { CoreMessage } from 'ai';
import { createHmac, timingSafeEqual } from 'crypto';
import { LinearClient } from '@linear/sdk';
import { Redis } from '@upstash/redis';
import { env } from '../../src/env.js';

const signingSecret = process.env.SLACK_SIGNING_SECRET!;

export const client = new WebClient(process.env.SLACK_BOT_TOKEN);

// Initialize Redis client for Linear token lookup
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

/**
 * Get a LinearClient for Slack contexts by checking available tokens in Redis
 */
export const getLinearClientForSlack = async (): Promise<
  LinearClient | undefined
> => {
  try {
    // First try to get the global Linear access token
    const globalToken = (await redis.get('linearAccessToken')) as string;
    if (globalToken) {
      return new LinearClient({ accessToken: globalToken });
    }

    // If no global token, try to find any organization-specific token
    // Get all keys that match the pattern linear:*:accessToken
    const keys = await redis.keys('linear:*:accessToken');
    if (keys && keys.length > 0) {
      // Use the first available organization token
      const firstOrgToken = (await redis.get(keys[0])) as string;
      if (firstOrgToken) {
        return new LinearClient({ accessToken: firstOrgToken });
      }
    }

    console.warn('No Linear access tokens found in Redis for Slack context');
    return undefined;
  } catch (error) {
    console.error('Error getting Linear client for Slack:', error);
    return undefined;
  }
};

// See https://api.slack.com/authentication/verifying-requests-from-slack
export async function isValidSlackRequest({
  request,
  rawBody,
}: {
  request: Request;
  rawBody: string;
}) {
  // console.log('Validating Slack request')
  const timestamp = request.headers.get('X-Slack-Request-Timestamp');
  const slackSignature = request.headers.get('X-Slack-Signature');
  // console.log(timestamp, slackSignature)

  if (!timestamp || !slackSignature) {
    console.log('Missing timestamp or signature');
    return false;
  }

  // Prevent replay attacks on the order of 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 60 * 5) {
    console.log('Timestamp out of range');
    return false;
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const hmac = createHmac('sha256', signingSecret).update(base).digest('hex');
  const computedSignature = `v0=${hmac}`;

  // Prevent timing attacks
  return timingSafeEqual(
    Buffer.from(computedSignature),
    Buffer.from(slackSignature)
  );
}

export const verifyRequest = async ({
  requestType,
  request,
  rawBody,
}: {
  requestType: string;
  request: Request;
  rawBody: string;
}) => {
  const validRequest = await isValidSlackRequest({ request, rawBody });
  if (!validRequest || requestType !== 'event_callback') {
    return new Response('Invalid request', { status: 400 });
  }
};

export const updateStatusUtil = (channel: string, thread_ts: string) => {
  return async (status: string) => {
    await client.assistant.threads.setStatus({
      channel_id: channel,
      thread_ts: thread_ts,
      status: status,
    });
  };
};

export async function getThread(
  channel_id: string,
  thread_ts: string,
  botUserId: string
): Promise<CoreMessage[]> {
  const { messages } = await client.conversations.replies({
    channel: channel_id,
    ts: thread_ts,
    limit: 50,
  });

  // Ensure we have messages

  if (!messages) throw new Error('No messages found in thread');

  const result = messages
    .map((message) => {
      const isBot = !!message.bot_id;
      if (!message.text) return null;

      // For app mentions, remove the mention prefix
      // For IM messages, keep the full text
      let content = message.text;
      if (!isBot && content.includes(`<@${botUserId}>`)) {
        content = content.replace(`<@${botUserId}> `, '');
      }

      return {
        role: isBot ? 'assistant' : 'user',
        content: content,
      } as CoreMessage;
    })
    .filter((msg): msg is CoreMessage => msg !== null);

  return result;
}

export const getBotId = async () => {
  const { user_id: botUserId } = await client.auth.test();

  if (!botUserId) {
    throw new Error('botUserId is undefined');
  }
  return botUserId;
};

export const sendMessage = async (
  channel: string,
  text: string,
  thread_ts?: string,
  blocks?: any[]
) => {
  // Convert markdown to Slack mrkdwn format
  text = text.replace(/\[(.*?)\]\((.*?)\)/g, '<$2|$1>').replace(/\*\*/g, '*');

  await client.chat.postMessage({
    channel: channel,
    text: text,
    thread_ts: thread_ts,
    unfurl_links: false,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: text,
        },
      },
      ...(blocks || []),
    ],
  });
};

// Enhanced messaging functions

/**
 * Send a direct message to a user by their user ID or email
 */
export const sendDirectMessage = async (
  userIdOrEmail: string,
  text: string,
  blocks?: any[]
) => {
  try {
    // If it looks like an email, find the user first
    let userId = userIdOrEmail;
    if (userIdOrEmail.includes('@')) {
      const userInfo = await getUserByEmail(userIdOrEmail);
      if (!userInfo?.id) {
        throw new Error(`User with email ${userIdOrEmail} not found`);
      }
      userId = userInfo.id;
    }

    // Open a DM channel with the user
    const { channel } = await client.conversations.open({
      users: userId,
    });

    if (!channel?.id) {
      throw new Error('Failed to open DM channel');
    }

    // Send the message
    return await sendMessage(channel.id, text, undefined, blocks);
  } catch (error) {
    console.error('Error sending direct message:', error);
    throw error;
  }
};

/**
 * Send a message to a channel by name or ID
 */
export const sendChannelMessage = async (
  channelNameOrId: string,
  text: string,
  thread_ts?: string,
  blocks?: any[]
) => {
  try {
    // If it starts with #, remove it and find the channel
    let channelId = channelNameOrId;
    if (channelNameOrId.startsWith('#')) {
      const channelName = channelNameOrId.slice(1);
      const channelInfo = await getChannelByName(channelName);
      if (!channelInfo?.id) {
        throw new Error(`Channel ${channelName} not found`);
      }
      channelId = channelInfo.id;
    }

    return await sendMessage(channelId, text, thread_ts, blocks);
  } catch (error) {
    console.error('Error sending channel message:', error);
    throw error;
  }
};

/**
 * Update an existing message
 */
export const updateMessage = async (
  channel: string,
  ts: string,
  text: string,
  blocks?: any[]
) => {
  try {
    // Convert markdown to Slack mrkdwn format
    text = text.replace(/\[(.*?)\]\((.*?)\)/g, '<$2|$1>').replace(/\*\*/g, '*');

    await client.chat.update({
      channel: channel,
      ts: ts,
      text: text,
      blocks: blocks || [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: text,
          },
        },
      ],
    });
  } catch (error) {
    console.error('Error updating message:', error);
    throw error;
  }
};

/**
 * Delete a message
 */
export const deleteMessage = async (channel: string, ts: string) => {
  try {
    await client.chat.delete({
      channel: channel,
      ts: ts,
    });
  } catch (error) {
    console.error('Error deleting message:', error);
    throw error;
  }
};

// Reaction functions

/**
 * Add a reaction to a message
 */
export const addReaction = async (
  channel: string,
  timestamp: string,
  emoji: string
) => {
  try {
    // Remove colons from emoji if present
    const cleanEmoji = emoji.replace(/:/g, '');

    await client.reactions.add({
      channel: channel,
      timestamp: timestamp,
      name: cleanEmoji,
    });
  } catch (error) {
    console.error('Error adding reaction:', error);
    throw error;
  }
};

/**
 * Remove a reaction from a message
 */
export const removeReaction = async (
  channel: string,
  timestamp: string,
  emoji: string
) => {
  try {
    // Remove colons from emoji if present
    const cleanEmoji = emoji.replace(/:/g, '');

    await client.reactions.remove({
      channel: channel,
      timestamp: timestamp,
      name: cleanEmoji,
    });
  } catch (error) {
    console.error('Error removing reaction:', error);
    throw error;
  }
};

/**
 * Get reactions for a message
 */
export const getReactions = async (channel: string, timestamp: string) => {
  try {
    const { message } = await client.reactions.get({
      channel: channel,
      timestamp: timestamp,
    });

    return message?.reactions || [];
  } catch (error) {
    console.error('Error getting reactions:', error);
    throw error;
  }
};

// Channel and conversation functions

/**
 * Get channel history with optional filters
 */
export const getChannelHistory = async (
  channel: string,
  options: {
    limit?: number;
    oldest?: string;
    latest?: string;
    inclusive?: boolean;
  } = {}
) => {
  try {
    const { messages } = await client.conversations.history({
      channel: channel,
      limit: options.limit || 20,
      oldest: options.oldest,
      latest: options.latest,
      inclusive: options.inclusive,
    });

    return messages || [];
  } catch (error) {
    console.error('Error getting channel history:', error);
    throw error;
  }
};

/**
 * Get brief channel history formatted for AI context
 */
export const getBriefChannelHistory = async (
  channel: string,
  limit: number = 10
): Promise<CoreMessage[]> => {
  try {
    const messages = await getChannelHistory(channel, { limit });
    const botUserId = await getBotId();

    return messages
      .reverse() // Show oldest first
      .map((message) => {
        const isBot = message.user === botUserId || !!message.bot_id;
        if (!message.text) return null;

        let content = message.text;
        // Clean up mentions and formatting
        if (!isBot && content.includes(`<@${botUserId}>`)) {
          content = content.replace(`<@${botUserId}> `, '');
        }

        return {
          role: isBot ? 'assistant' : 'user',
          content: content,
        } as CoreMessage;
      })
      .filter((msg): msg is CoreMessage => msg !== null);
  } catch (error) {
    console.error('Error getting brief channel history:', error);
    return [];
  }
};

/**
 * Get channel information by name
 */
export const getChannelByName = async (channelName: string) => {
  try {
    const { channels } = await client.conversations.list({
      types: 'public_channel,private_channel',
      limit: 1000,
    });

    const channel = channels?.find(
      (ch) =>
        ch.name === channelName || ch.name === channelName.replace('#', '')
    );

    if (!channel) {
      throw new Error(`Channel ${channelName} not found`);
    }

    return channel;
  } catch (error) {
    console.error('Error finding channel by name:', error);
    throw error;
  }
};

/**
 * Get channel information by ID
 */
export const getChannelInfo = async (channelId: string) => {
  try {
    const { channel } = await client.conversations.info({
      channel: channelId,
    });

    return channel;
  } catch (error) {
    console.error('Error getting channel info:', error);
    throw error;
  }
};

/**
 * Join a channel
 */
export const joinChannel = async (channelId: string) => {
  try {
    await client.conversations.join({
      channel: channelId,
    });
  } catch (error) {
    console.error('Error joining channel:', error);
    throw error;
  }
};

/**
 * Leave a channel
 */
export const leaveChannel = async (channelId: string) => {
  try {
    await client.conversations.leave({
      channel: channelId,
    });
  } catch (error) {
    console.error('Error leaving channel:', error);
    throw error;
  }
};

// User functions

/**
 * Get user information by user ID
 */
export const getUserInfo = async (userId: string) => {
  try {
    const { user } = await client.users.info({
      user: userId,
    });

    return user;
  } catch (error) {
    console.error('Error getting user info:', error);
    throw error;
  }
};

/**
 * Get user information by email
 */
export const getUserByEmail = async (email: string) => {
  try {
    const { user } = await client.users.lookupByEmail({
      email: email,
    });

    if (!user) {
      throw new Error(`User with email ${email} not found`);
    }

    return user;
  } catch (error) {
    console.error('Error getting user by email:', error);
    throw error;
  }
};

/**
 * Get workspace users
 */
export const getWorkspaceUsers = async (limit: number = 100) => {
  try {
    const { members } = await client.users.list({
      limit: limit,
    });

    return members || [];
  } catch (error) {
    console.error('Error getting workspace users:', error);
    throw error;
  }
};

/**
 * Set user status
 */
export const setStatus = async (
  statusText: string,
  statusEmoji?: string,
  statusExpiration?: number
) => {
  try {
    await client.users.profile.set({
      profile: {
        status_text: statusText,
        status_emoji: statusEmoji || '',
        status_expiration: statusExpiration || 0,
      },
    });
  } catch (error) {
    console.error('Error setting status:', error);
    throw error;
  }
};

/**
 * Set user presence (auto/away)
 */
export const setPresence = async (presence: 'auto' | 'away') => {
  try {
    await client.users.setPresence({
      presence: presence,
    });
  } catch (error) {
    console.error('Error setting presence:', error);
    throw error;
  }
};

// File and upload functions

/**
 * Upload a file to Slack
 */
export const uploadFile = async (
  file: Buffer | string,
  filename: string,
  channels?: string[],
  title?: string,
  initialComment?: string
) => {
  try {
    const result = await client.files.upload({
      file: file,
      filename: filename,
      channels: channels?.join(','),
      title: title,
      initial_comment: initialComment,
    });

    return result.file;
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
};

/**
 * Share a file to channels
 */
export const shareFile = async (fileId: string, channels: string[]) => {
  try {
    await client.files.sharedPublicURL({
      file: fileId,
    });

    // Share to specific channels
    for (const channel of channels) {
      await client.chat.postMessage({
        channel: channel,
        text: `Shared file: <@${fileId}>`,
      });
    }
  } catch (error) {
    console.error('Error sharing file:', error);
    throw error;
  }
};

// Utility functions

/**
 * Search for messages in the workspace
 */
export const searchMessages = async (
  query: string,
  options: {
    sort?: 'score' | 'timestamp';
    sortDir?: 'asc' | 'desc';
    count?: number;
  } = {}
) => {
  try {
    const { messages } = await client.search.messages({
      query: query,
      sort: options.sort || 'score',
      sort_dir: options.sortDir || 'desc',
      count: options.count || 20,
    });

    return messages;
  } catch (error) {
    console.error('Error searching messages:', error);
    throw error;
  }
};

/**
 * Get permalink for a message
 */
export const getPermalink = async (channel: string, messageTs: string) => {
  try {
    const { permalink } = await client.chat.getPermalink({
      channel: channel,
      message_ts: messageTs,
    });

    return permalink;
  } catch (error) {
    console.error('Error getting permalink:', error);
    throw error;
  }
};

/**
 * Schedule a message to be sent later
 */
export const scheduleMessage = async (
  channel: string,
  text: string,
  postAt: number,
  thread_ts?: string
) => {
  try {
    const result = await client.chat.scheduleMessage({
      channel: channel,
      text: text,
      post_at: postAt,
      thread_ts: thread_ts,
    });

    return result;
  } catch (error) {
    console.error('Error scheduling message:', error);
    throw error;
  }
};

/**
 * Pin a message to a channel
 */
export const pinMessage = async (channel: string, timestamp: string) => {
  try {
    await client.pins.add({
      channel: channel,
      timestamp: timestamp,
    });
  } catch (error) {
    console.error('Error pinning message:', error);
    throw error;
  }
};

/**
 * Unpin a message from a channel
 */
export const unpinMessage = async (channel: string, timestamp: string) => {
  try {
    await client.pins.remove({
      channel: channel,
      timestamp: timestamp,
    });
  } catch (error) {
    console.error('Error unpinning message:', error);
    throw error;
  }
};
