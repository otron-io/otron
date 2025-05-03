import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createLinearClient } from '../../src/utils/linear-client.js';
import { DevAgent } from '../../src/agents/dev-agent.js';
import { env } from '../../src/env.js';

/**
 * API endpoint for the dev agent
 * This endpoint is called by the main agent to delegate technical tasks
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  // Verify internal API token
  const authToken = req.headers['x-internal-token'] as string;
  if (authToken !== env.INTERNAL_API_TOKEN) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  try {
    // Parse request body
    const { issue, notificationType, commentId, taskDescription } = req.body;

    if (!issue) {
      res.status(400).json({ message: 'Missing required field: issue' });
      return;
    }

    if (!taskDescription) {
      res
        .status(400)
        .json({ message: 'Missing required field: taskDescription' });
      return;
    }

    // Create Linear client
    const linearClient = createLinearClient();

    // Initialize dev agent
    const devAgent = new DevAgent(linearClient);

    // Process the task asynchronously (don't await, return response immediately)
    devAgent
      .processTask({
        issue,
        notificationType,
        commentId,
        taskDescription,
      })
      .catch((error) => {
        console.error('Error in dev agent background task:', error);
      });

    // Return immediate response
    res.status(200).json({
      message: 'Task delegated to dev agent',
      issueId: issue.id,
      task: taskDescription,
    });
  } catch (error) {
    console.error('Error in dev agent endpoint:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
