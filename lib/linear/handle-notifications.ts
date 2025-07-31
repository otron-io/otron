import { LinearClient } from '@linear/sdk';
import { generateResponse } from '../generate-response.js';
import {
  linearAgentSessionManager,
  agentActivity,
} from './linear-agent-session-manager.js';

/**
 * Linear notification handler for Agent Session Events
 * Uses Linear's official Agents SDK for structured agent interactions
 */
export async function handleLinearNotification(
  payload: any,
  linearClient: LinearClient,
  appUserId: string
) {
  try {
    console.log('Handling Linear notification:', payload.type, payload.action);

    // Handle Agent Session Events (the new official way)
    if (payload.type === 'AgentSessionEvent') {
      return await handleAgentSessionEvent(payload, linearClient, appUserId);
    }

    // Convert legacy AppUserNotification to AgentSessionEvent format
    if (
      payload.type === 'AppUserNotification' &&
      (payload.action === 'issueCommentMention' ||
        payload.action === 'issueAssignedToYou')
    ) {
      console.log(
        '⚠️ MIGRATION NOTICE: Converting legacy AppUserNotification to AgentSessionEvent format'
      );
      console.log(
        '👉 Please update your Linear OAuth app to enable "Agent session events" webhook category'
      );

      // Transform legacy notification into AgentSessionEvent format
      const agentSessionPayload = {
        type: 'AgentSessionEvent',
        action: 'created', // Both mentions and assignments create new sessions
        agentSession: {
          id: `legacy-${payload.notification.id}`, // Generate session ID from notification ID
          appUserId: appUserId,
          issue: payload.notification.issue,
          comment:
            payload.action === 'issueCommentMention'
              ? payload.notification.comment
              : undefined,
          previousComments: [], // Legacy notifications don't provide this context
        },
      };

      return await handleAgentSessionEvent(
        agentSessionPayload,
        linearClient,
        appUserId
      );
    }

    // Log and skip any other notification types
    console.log(
      `Unsupported notification type: ${payload.type}/${payload.action}`
    );
    console.log(
      'This agent only responds to AgentSessionEvent webhooks (created/prompted)'
    );
  } catch (error) {
    console.error('Error handling Linear notification:', error);
  }
}

/**
 * Handle new Agent Session Events from Linear
 * - 'created': Agent mentioned or assigned to issue
 * - 'prompted': User sent new message to existing session
 */
async function handleAgentSessionEvent(
  payload: any,
  linearClient: LinearClient,
  appUserId: string
) {
  try {
    const { action, agentSession } = payload;

    console.log(`Handling Agent Session Event: ${action}`, {
      sessionId: agentSession?.id,
      issueId: agentSession?.issue?.id,
    });

    // Validate that this is for our agent
    if (agentSession?.appUserId !== appUserId) {
      console.log('Agent session event is for a different app user, skipping');
      return;
    }

    // Set up the Linear client for the agent session manager
    linearAgentSessionManager.setLinearClient(linearClient);

    if (action === 'created') {
      await handleAgentSessionCreated(agentSession, linearClient);
    } else if (action === 'prompted') {
      await handleAgentSessionPrompted(agentSession, linearClient);
    } else {
      console.log(`Unknown agent session action: ${action}`);
    }
  } catch (error) {
    console.error('Error handling Agent Session Event:', error);
  }
}

/**
 * Handle 'created' Agent Session Event - new session started
 * Triggered when agent is mentioned or assigned/delegated to an issue
 */
async function handleAgentSessionCreated(
  agentSession: any,
  linearClient: LinearClient
) {
  const sessionId = agentSession.id;
  const issue = agentSession.issue;

  if (!issue) {
    console.error('Agent session created without an issue');
    return;
  }

  console.log(
    `Agent session created for issue ${issue.identifier}: ${issue.title}`
  );

  // Send immediate acknowledgment thought (required within 10 seconds)
  await agentActivity.thought(
    issue.id,
    `🚀 Agent session started for issue ${issue.identifier}. Analyzing the issue and context...`
  );

  // Build context from the issue and any related comments
  let contextMessage = `You have been assigned to work on Linear issue ${issue.identifier}: ${issue.title}`;

  if (issue.description) {
    contextMessage += `\n\nDescription: ${issue.description}`;
  }

  // Include any recent comments or the specific comment that triggered this
  if (agentSession.comment) {
    const comment = agentSession.comment;
    const user = comment.user;
    const userName = user?.name || 'Unknown';
    contextMessage += `\n\nTriggering comment by ${userName}: ${comment.body}`;
  }

  // Include previous comments for context
  if (
    agentSession.previousComments &&
    agentSession.previousComments.length > 0
  ) {
    contextMessage += `\n\nPrevious comments for context:`;
    for (const comment of agentSession.previousComments) {
      const user = comment.user;
      const userName = user?.name || 'Unknown';
      contextMessage += `\n- ${userName}: ${comment.body}`;
    }
  }

  contextMessage += `\n\nPlease analyze this issue thoroughly and take appropriate actions. You can use Linear, GitHub, or Slack tools as needed.`;

  // Simple status update function
  const updateStatus = async (status: string) => {
    console.log(`Agent Session Status: ${status}`);
  };

  // Generate response using AI
  await generateResponse(
    [{ role: 'user', content: contextMessage }],
    updateStatus,
    linearClient,
    undefined, // No Slack context
    undefined // No abort signal
  );
}

/**
 * Handle 'prompted' Agent Session Event - user sent new message
 * Triggered when user responds to agent or sends follow-up message
 */
async function handleAgentSessionPrompted(
  agentSession: any,
  linearClient: LinearClient
) {
  const sessionId = agentSession.id;
  const issue = agentSession.issue;

  if (!issue) {
    console.error('Agent session prompted without an issue');
    return;
  }

  console.log(`Agent session prompted for issue ${issue.identifier}`);

  // Look for the new user activity (prompt)
  let userPrompt = '';
  if (
    agentSession.agentActivity &&
    agentSession.agentActivity.content.type === 'prompt'
  ) {
    userPrompt = agentSession.agentActivity.content.body;
  }

  if (!userPrompt) {
    console.error('No user prompt found in agent session prompted event');
    return;
  }

  // Send acknowledgment
  await agentActivity.thought(
    issue.id,
    `📩 Received user prompt: "${userPrompt.substring(0, 100)}${
      userPrompt.length > 100 ? '...' : ''
    }"`
  );

  // Build context message
  let contextMessage = `You are continuing work on Linear issue ${issue.identifier}: ${issue.title}`;
  contextMessage += `\n\nNew user prompt: ${userPrompt}`;

  if (issue.description) {
    contextMessage += `\n\nIssue description: ${issue.description}`;
  }

  contextMessage += `\n\nPlease respond to the user's prompt and take appropriate actions.`;

  // Simple status update function
  const updateStatus = async (status: string) => {
    console.log(`Agent Session Status: ${status}`);
  };

  // Generate response using AI
  await generateResponse(
    [{ role: 'user', content: contextMessage }],
    updateStatus,
    linearClient,
    undefined, // No Slack context
    undefined // No abort signal
  );
}
