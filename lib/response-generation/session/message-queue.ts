import { Redis } from '@upstash/redis';
import { env } from '../../core/env.js';
import { QueuedMessage } from '../core/types.js';

// Initialize Redis client for message queuing
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

/**
 * Queue a message for an active agent session
 */
export async function queueMessageForSession(
  sessionId: string,
  message: QueuedMessage
): Promise<void> {
  try {
    const queueKey = `message_queue:${sessionId}`;
    await redis.lpush(queueKey, JSON.stringify(message));
    await redis.expire(queueKey, 3600); // 1 hour TTL

    console.log(`Queued message for session ${sessionId}`);
  } catch (error) {
    console.error('Error queuing message:', error);
  }
}

/**
 * Get queued messages for a session and clear the queue
 */
export async function getQueuedMessages(
  sessionId: string
): Promise<QueuedMessage[]> {
  try {
    const queueKey = `message_queue:${sessionId}`;
    const messages = await redis.lrange(queueKey, 0, -1);

    if (messages.length > 0) {
      // Clear the queue
      await redis.del(queueKey);

      // Parse and return messages (newest first)
      return messages.reverse().map((msg) => {
        if (typeof msg === 'string') {
          return JSON.parse(msg) as QueuedMessage;
        }
        return msg as QueuedMessage;
      });
    }

    return [];
  } catch (error) {
    console.error('Error getting queued messages:', error);
    return [];
  }
}
