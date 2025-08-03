import { Redis } from "@upstash/redis";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withInternalAccess } from "../lib/core/auth.js";
import { env } from "../lib/core/env.js";

// Initialize Redis client
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept GET requests
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { issueId, skip = "0", limit = "20" } = req.query;

  if (!issueId || typeof issueId !== "string") {
    res.status(400).json({ error: "Issue ID is required" });
    return;
  }

  try {
    const skipNum = Number.parseInt(skip as string) || 0;
    const limitNum = Number.parseInt(limit as string) || 20;

    // Fetch actions for the issue
    const actions = await redis.lrange(
      `memory:issue:${issueId}:action`,
      skipNum,
      skipNum + limitNum - 1,
    );

    const parsedActions = actions
      .map((action) => {
        try {
          return typeof action === "object" ? action : JSON.parse(action);
        } catch (e) {
          console.error(`Error parsing action for issue ${issueId}:`, e);
          return null;
        }
      })
      .filter((a) => a !== null);

    // Get total count for pagination info
    const totalActions = await redis.llen(`memory:issue:${issueId}:action`);

    res.status(200).json({
      actions: parsedActions,
      totalActions,
      skip: skipNum,
      limit: limitNum,
      hasMore: skipNum + limitNum < totalActions,
      issueId,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error(`Error retrieving actions for issue ${issueId}:`, error);
    res.status(500).json({ error: "Failed to retrieve issue actions" });
  }
}

// Export the handler with internal access protection
export default withInternalAccess(handler);
