import { LinearClient } from '@linear/sdk';
import { generateResponse } from '../generate-response.js';

// Linear notification handler that follows the same pattern as Slack events
export async function handleLinearNotification(
  payload: any,
  linearClient: LinearClient,
  appUserId: string
) {
  try {
    console.log('Handling Linear notification:', payload.action);

    // Only handle specific notification types
    if (
      payload.action !== 'issueAssignedToYou' &&
      payload.action !== 'issueCommentMention'
    ) {
      console.log(`Skipping notification type: ${payload.action}`);
      return;
    }

    const notification = payload.notification;
    const issueId = notification.issueId;
    const commentId = notification.commentId;

    // Get the issue either directly or through a comment
    let issue: any;
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

    // Simple status update function for logging
    const updateStatus = async (status: string) => {
      console.log(`Status update: ${status}`);
    };

    // Build context message for the AI
    let contextMessage = '';

    if (payload.action === 'issueAssignedToYou') {
      contextMessage = `You have been assigned to Linear issue ${issue.identifier}: ${issue.title}`;
      if (issue.description) {
        contextMessage += `\n\nDescription: ${issue.description}`;
      }
    } else if (payload.action === 'issueCommentMention') {
      contextMessage = `You were mentioned in a comment on Linear issue ${issue.identifier}: ${issue.title}`;

      // Get the specific comment if we have a commentId
      if (commentId) {
        try {
          const comment = await linearClient.comment({ id: commentId });
          const user = await comment.user;
          const userName = user?.name || 'Unknown';
          contextMessage += `\n\nComment by ${userName}: ${comment.body}`;
        } catch (e) {
          console.error('Failed to get comment details:', e);
        }
      }
    }

    // Add issue context
    contextMessage += `\n\nPlease analyze this issue and provide appropriate assistance. You can take actions on Linear, GitHub, or Slack as needed.`;

    // Generate response using AI
    const response = await generateResponse(
      [{ role: 'user', content: contextMessage }],
      updateStatus,
      linearClient
    );

    // Add the response as a comment to the issue
    if (issue) {
      await linearClient.createComment({
        issueId: issue.id,
        body: response,
      });
    }
  } catch (error) {
    console.error('Error handling Linear notification:', error);
  }
}
