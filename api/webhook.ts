import crypto from 'node:crypto';
import { LinearClient } from '@linear/sdk';
import { Redis } from '@upstash/redis';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getIssueContext, respondToMessage } from '../src/ai.js';
import { env } from '../src/env.js';

// Initialize Redis client
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

// Verify webhook signature from Linear
export function verifySignature(signature: string, body: string): boolean {
  const hmac = crypto.createHmac('sha256', env.WEBHOOK_SIGNING_SECRET);
  hmac.update(body);
  const computedSignature = hmac.digest('hex');

  return signature === computedSignature;
}

// Main webhook handler
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only handle POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = JSON.stringify(req.body);
  const signature = req.headers['linear-signature'] as string;

  // Verify webhook signature
  if (!signature || !verifySignature(signature, rawBody)) {
    console.error('Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload = req.body;
  console.log('Received webhook:', JSON.stringify(payload, null, 2));

  try {
    // Get stored tokens from Redis
    const orgId = payload.organizationId;
    const accessToken = (await redis.get(
      `linear:${orgId}:accessToken`
    )) as string;
    const appUserId = (await redis.get(`linear:${orgId}:appUserId`)) as string;

    if (!accessToken) {
      console.error(`No access token found for organization ${orgId}`);
      return res.status(500).json({ error: 'Authentication missing' });
    }

    // Initialize Linear client with stored credentials
    const linearClient = new LinearClient({ accessToken });

    // Process the webhook based on action type
    if (payload.type === 'AppUserNotification') {
      const notification = payload.notification;

      // Handle the notification autonomously
      await handleAutonomously(
        notification,
        linearClient,
        appUserId,
        payload.action
      );
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).json({ error: 'Failed to process webhook' });
  }
}

// Unified autonomous handler for all notifications
async function handleAutonomously(
  notification: any,
  linearClient: LinearClient,
  appUserId: string,
  action?: string
) {
  try {
    // Determine if we have an issue ID or comment ID to work with
    const issueId = notification.issueId;
    const commentId = notification.commentId;

    // Get the issue either directly or through a comment
    let issue;
    if (issueId) {
      issue = await linearClient.issue(issueId);
    } else if (commentId) {
      const comment = await linearClient.comment({ id: commentId });
      issue = await comment.issue;
    }

    if (!issue) {
      console.error('Could not find an issue to process');
      return;
    }

    // React to show we're processing
    try {
      if (issueId) {
        await linearClient.createReaction({
          issueId: issue.id,
          emoji: 'eyes',
        });
      } else if (commentId) {
        await linearClient.createReaction({
          commentId,
          emoji: 'eyes',
        });
      }
    } catch (e) {
      console.error('Failed to add processing reaction:', e);
    }

    // Get the LinearGPT service and let it handle everything
    const { LinearGPT } = await import('../src/linear-gpt.js');
    const gpt = new LinearGPT(linearClient);

    // Let the model directly handle the notification
    await gpt.processNotification({
      issue,
      notificationType: action,
      commentId,
      appUserId,
    });

    // React to show we've completed processing
    try {
      if (issueId) {
        await linearClient.createReaction({
          issueId: issue.id,
          emoji: 'white_check_mark',
        });
      } else if (commentId) {
        await linearClient.createReaction({
          commentId,
          emoji: 'white_check_mark',
        });
      }
    } catch (e) {
      console.error('Failed to add completion reaction:', e);
    }
  } catch (error) {
    console.error('Error handling notification:', error);
    // Try to add an error reaction if possible
    if (notification.issueId) {
      try {
        await linearClient.createReaction({
          issueId: notification.issueId,
          emoji: 'x',
        });
      } catch (e) {
        console.error('Failed to add error reaction:', e);
      }
    } else if (notification.commentId) {
      try {
        await linearClient.createReaction({
          commentId: notification.commentId,
          emoji: 'x',
        });
      } catch (e) {
        console.error('Failed to add error reaction:', e);
      }
    }
  }
}
