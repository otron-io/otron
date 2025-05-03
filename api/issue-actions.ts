import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { env } from '../src/env.js';
import { withPasswordProtection } from '../src/utils/auth.js';

// Initialize Redis client
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { issueId, skip = '0', limit = '20' } = req.query;

    // Validate parameters
    if (!issueId || typeof issueId !== 'string') {
      return res
        .status(400)
        .json({ error: 'Missing or invalid issueId parameter' });
    }

    // Parse skip and limit to integers with defaults
    const skipInt = parseInt(skip as string, 10) || 0;
    const limitInt = parseInt(limit as string, 10) || 20;

    // Fetch actions for the issue
    const actionsKey = `memory:issue:${issueId}:action`;
    const actionCount = await redis.llen(actionsKey);

    if (actionCount === 0) {
      return res.status(200).json({ actions: [], total: 0 });
    }

    // Get actions with pagination
    const actionData = await redis.lrange(
      actionsKey,
      skipInt,
      skipInt + limitInt - 1
    );

    // Parse the actions
    const parsedActions = actionData
      .map((action) => {
        try {
          return typeof action === 'object' ? action : JSON.parse(action);
        } catch (e) {
          console.error(`Error parsing action for issue ${issueId}:`, e);
          return null;
        }
      })
      .filter((a) => a !== null);

    return res.status(200).json({
      actions: parsedActions,
      total: actionCount,
      remaining: Math.max(0, actionCount - (skipInt + parsedActions.length)),
    });
  } catch (error) {
    console.error('Error fetching issue actions:', error);
    return res.status(500).json({ error: 'Failed to fetch issue actions' });
  }
}

// Export the handler with password protection
export default withPasswordProtection(handler);
