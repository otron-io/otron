import { CoreMessage } from 'ai';
import { SlackContext } from '../core/types.js';

/**
 * Extract issue ID from message context
 * Tries to find Linear issue IDs (OTR-123, ABC-456) or falls back to Slack context
 */
export function extractIssueIdFromContext(
  messages: CoreMessage[],
  slackContext?: SlackContext
): string {
  // Try to extract issue ID from message content
  for (const message of messages) {
    if (typeof message.content === 'string') {
      // Look for Linear issue patterns like OTR-123, ABC-456, etc.
      const issueMatch = message.content.match(/\b([A-Z]{2,}-\d+)\b/);
      if (issueMatch) {
        return issueMatch[1];
      }

      // Look for issue ID in Linear notification context
      const issueIdMatch = message.content.match(/issue\s+([a-f0-9-]{36})/i);
      if (issueIdMatch) {
        return issueIdMatch[1];
      }
    }
  }

  // If no issue ID found in messages, use Slack context as fallback
  if (slackContext?.channelId) {
    return `slack:${slackContext.channelId}${
      slackContext.threadTs ? `:${slackContext.threadTs}` : ''
    }`;
  }

  // Default fallback
  return 'general';
}

/**
 * Determine platform based on context
 */
export function determinePlatform(
  contextId: string,
  slackContext?: SlackContext
): 'slack' | 'linear' | 'github' | 'general' {
  if (slackContext) {
    return 'slack';
  } else if (contextId && !contextId.startsWith('slack:')) {
    return 'linear';
  }
  return 'general';
}
