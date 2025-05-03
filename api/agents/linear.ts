import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createLinearClient } from '../../src/utils/linear-client.js';
import { LinearAgent } from '../../src/agents/linear-agent.js';
import { env } from '../../src/env.js';

/**
 * API endpoint for the linear agent
 * This endpoint is called by the main agent to delegate product management tasks
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

    // Initialize linear agent
    const linearAgent = new LinearAgent(linearClient);

    // Process the task asynchronously (don't await, return response immediately)
    linearAgent
      .processTask({
        issue,
        notificationType,
        commentId,
        taskDescription,
      })
      .catch((error) => {
        console.error('Error in linear agent background task:', error);
      });

    // Return immediate response
    res.status(200).json({
      message: 'Task delegated to linear agent',
      issueId: issue.id,
      task: taskDescription,
    });
  } catch (error) {
    console.error('Error in linear agent endpoint:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
