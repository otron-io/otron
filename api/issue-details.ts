import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { env } from '../lib/core/env.js';
import { withInternalAccess } from '../lib/core/auth.js';

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

  const { issueId, type = 'all', skip = '0', limit = '50' } = req.query;

  if (!issueId || typeof issueId !== 'string') {
    return res.status(400).json({ error: 'Issue ID is required' });
  }

  try {
    const skipNum = parseInt(skip as string) || 0;
    const limitNum = parseInt(limit as string) || 50;

    let result: any = {};

    if (type === 'all' || type === 'actions') {
      // Fetch actions for the issue
      const actions = await redis.lrange(
        `memory:issue:${issueId}:action`,
        skipNum,
        skipNum + limitNum - 1
      );

      const parsedActions = actions
        .map((action) => {
          try {
            return typeof action === 'object' ? action : JSON.parse(action);
          } catch (e) {
            console.error(`Error parsing action for issue ${issueId}:`, e);
            return null;
          }
        })
        .filter((a) => a !== null);

      result.actions = parsedActions;
    }

    if (type === 'all' || type === 'conversations') {
      // Fetch conversations for the issue
      const conversations = await redis.lrange(
        `memory:issue:${issueId}:conversation`,
        skipNum,
        skipNum + limitNum - 1
      );

      const parsedConversations = conversations
        .map((conv) => {
          try {
            return typeof conv === 'object' ? conv : JSON.parse(conv);
          } catch (e) {
            console.error(
              `Error parsing conversation for issue ${issueId}:`,
              e
            );
            return null;
          }
        })
        .filter((c) => c !== null);

      result.conversations = parsedConversations;
    }

    if (type === 'all' || type === 'context') {
      // Fetch context entries for the issue
      const context = await redis.lrange(
        `memory:issue:${issueId}:context`,
        skipNum,
        skipNum + limitNum - 1
      );

      const parsedContext = context
        .map((ctx) => {
          try {
            return typeof ctx === 'object' ? ctx : JSON.parse(ctx);
          } catch (e) {
            console.error(`Error parsing context for issue ${issueId}:`, e);
            return null;
          }
        })
        .filter((c) => c !== null);

      result.context = parsedContext;
    }

    // Get total counts for pagination
    if (type === 'all' || type === 'actions') {
      result.totalActions = await redis.llen(`memory:issue:${issueId}:action`);
    }

    if (type === 'all' || type === 'conversations') {
      result.totalConversations = await redis.llen(
        `memory:issue:${issueId}:conversation`
      );
    }

    if (type === 'all' || type === 'context') {
      result.totalContext = await redis.llen(`memory:issue:${issueId}:context`);
    }

    // Add metadata
    result.issueId = issueId;
    result.skip = skipNum;
    result.limit = limitNum;
    result.timestamp = Date.now();

    return res.status(200).json(result);
  } catch (error) {
    console.error(`Error retrieving details for issue ${issueId}:`, error);
    return res.status(500).json({ error: 'Failed to retrieve issue details' });
  }
}

// Export the handler with internal access protection
export default withInternalAccess(handler);
