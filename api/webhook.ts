import { createHash, timingSafeEqual } from 'node:crypto';
import { LinearClient } from '@linear/sdk';
import { Redis } from '@upstash/redis';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { env } from '../lib/env.js';
import { verifyLinearWebhook } from '../lib/auth.js';
import { waitUntil } from '@vercel/functions';
import { handleLinearNotification } from '../lib/linear/handle-notifications.js';

// Initialize Redis client
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

// 5 minutes
export const maxDuration = 300;

// Main webhook handler
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only handle POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = JSON.stringify(req.body);
  const signature = req.headers['linear-signature'] as string;

  // Verify webhook signature
  if (!signature || !verifyLinearWebhook(signature, rawBody)) {
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

    // Handle different notification types
    if (payload.type === 'AppUserNotification') {
      // Use waitUntil to handle the notification asynchronously like events
      waitUntil(handleLinearNotification(payload, linearClient, appUserId));
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).json({ error: 'Failed to process webhook' });
  }
}
