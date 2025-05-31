import { WebClient } from '@slack/web-api';
import { CoreMessage } from 'ai';
import { createHmac, timingSafeEqual } from 'crypto';
import { LinearClient } from '@linear/sdk';
import { Redis } from '@upstash/redis';
import { env } from '../env.js';


const signingSecret = process.env.SLACK_SIGNING_SECRET!;

// Use user OAuth token for full search permissions
export const client = new WebClient(process.env.SLACK_USER_TOKEN);

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
  // Always verify the request signature for security
  const validRequest = await isValidSlackRequest({ request, rawBody });

  if (!validRequest) {
    throw new Error('Invalid Slack request signature');
  }

  // All request types should pass signature verification
  // url_verification, event_callback, and interactive payloads are all valid
  const validRequestTypes = [
    'url_verification',
    'event_callback',
    'interactive',
  ];

  if (!validRequestTypes.includes(requestType)) {
    throw new Error(`Invalid request type: ${requestType}`);
  }

  // Request is valid
  return true;
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

      // Include metadata about the message for better context
      const messageContext = {
        timestamp: message.ts,
        user: message.user,
        channel: channel_id,
        isBot,
      };

      // Format content with metadata for AI context
      const contextualContent = isBot
        ? content
        : `[Message from user ${message.user} at ${message.ts}]: ${content}`;

      return {
        role: isBot ? 'assistant' : 'user',
        content: contextualContent,
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