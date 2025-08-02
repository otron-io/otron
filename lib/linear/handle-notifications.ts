import { LinearClient } from '@linear/sdk';
import {
  generateResponse,
  getActiveSessionForIssue,
  queueMessageForSession,
  QueuedMessage,
} from '../generate-response.js';
import {
  linearAgentSessionManager,
  agentActivityDirect,
} from './linear-agent-session-manager.js';
import { getIssueContext } from './linear-utils.js';

// Map to store AbortControllers for active sessions
const sessionAbortControllers = new Map<string, AbortController>();

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
      return await handleAgentSessionCreated(
        agentSession,
        linearClient,
        payload.previousComments
      );
    } else if (action === 'prompted') {
      return await handleAgentSessionPrompted(payload, linearClient);
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
 *
 * CRITICAL: Must send acknowledgment within 10 seconds to avoid being marked unresponsive
 */
async function handleAgentSessionCreated(
  agentSession: any,
  linearClient: LinearClient,
  previousComments?: any[]
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

  // Check for /stop command in the initial comment
  const initialComment = agentSession.comment?.body || '';
  if (initialComment.trim().toLowerCase() === '/stop') {
    console.log(
      `🛑 Stop command received in initial session creation for ${sessionId}`
    );

    // Send immediate response about stopping
    await agentActivityDirect.response(
      sessionId,
      '🛑 **Otron is immediately stopping all operations** as requested. No actions will be taken.'
    );

    // Complete the session
    try {
      await linearAgentSessionManager.completeSession(sessionId);
      console.log(
        `Completed Linear agent session after initial stop command: ${sessionId}`
      );
    } catch (error) {
      console.error(
        'Error completing Linear agent session after initial stop:',
        error
      );
    }

    return;
  }

  // Check if there's already an active agent session for this issue
  const activeSessionId = await getActiveSessionForIssue(issue.id);

  if (activeSessionId && activeSessionId !== sessionId) {
    console.log(
      `Found active session ${activeSessionId} for issue ${issue.id}, ${
        initialComment.trim().toLowerCase() === '/stop'
          ? 'stopping active session'
          : 'queuing this request'
      }`
    );

    // If this is a stop command, abort the active session instead of queuing
    if (initialComment.trim().toLowerCase() === '/stop') {
      // Send stop command to the active session
      const stopMessage: QueuedMessage = {
        timestamp: Date.now(),
        type: 'stop',
        content: 'STOP_COMMAND',
        sessionId: sessionId,
        issueId: issue.id,
        metadata: {
          agentSession,
          previousComments,
          originalSessionId: activeSessionId,
        },
      };

      await queueMessageForSession(activeSessionId, stopMessage);

      // Send immediate response about stopping
      await agentActivityDirect.response(
        sessionId,
        '🛑 **Otron is immediately stopping all operations** as requested. The active session has been terminated.'
      );

      return;
    }

    // IMMEDIATE ACKNOWLEDGMENT still required for non-stop commands
    await agentActivityDirect.thought(
      sessionId,
      `Agent session acknowledged - joining active analysis for ${issue.identifier}`
    );

    // Queue this message for the active session
    const queuedMessage: QueuedMessage = {
      timestamp: Date.now(),
      type: 'created',
      content: `New agent session created: ${
        agentSession.comment?.body || 'No comment'
      }`,
      sessionId: sessionId,
      issueId: issue.id,
      metadata: { previousComments, agentSession },
    };

    await queueMessageForSession(activeSessionId, queuedMessage);

    // Complete this session since it's been merged with the active one
    await agentActivityDirect.response(
      sessionId,
      `Merged with active session ${activeSessionId}`
    );

    return;
  }

  // Register the existing session ID from webhook with the session manager
  linearAgentSessionManager.registerExistingSession(sessionId, issue.id);

  // IMMEDIATE ACKNOWLEDGMENT (required within 10 seconds)
  await agentActivityDirect.thought(
    sessionId,
    `Agent session started for issue ${issue.identifier}`
  );

  console.log(
    `✅ Acknowledgment sent for session ${sessionId}, starting processing`
  );

  // Return the async processing Promise for waitUntil to handle
  const asyncPromise = processAgentSessionWorkWithErrorHandling(
    agentSession,
    linearClient,
    sessionId,
    previousComments
  );

  console.log(
    `🔄 Async Promise created for session ${sessionId}, returning to waitUntil`
  );
  return asyncPromise;
}

/**
 * Wrapper for async processing with error handling that can be used by waitUntil
 */
async function processAgentSessionWorkWithErrorHandling(
  agentSession: any,
  linearClient: LinearClient,
  sessionId: string,
  previousComments?: any[]
): Promise<void> {
  console.log(
    `🚀 processAgentSessionWorkWithErrorHandling STARTED for session ${sessionId}`
  );

  try {
    console.log(`⏳ Starting async processing for session ${sessionId}`);
    await processAgentSessionWork(
      agentSession,
      linearClient,
      sessionId,
      previousComments
    );
    console.log(
      `✅ processAgentSessionWork COMPLETED for session ${sessionId}`
    );
  } catch (error) {
    console.error('Error in async agent session processing:', error);
    // Log error to Linear using the real session ID
    try {
      await agentActivityDirect.error(
        sessionId,
        `Failed to process agent session: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } catch (logError) {
      console.error('Failed to log error to Linear:', logError);
    }
  }
}

/**
 * Process the full agent session work asynchronously
 * This runs after webhook acknowledgment to avoid timeout issues
 */
async function processAgentSessionWork(
  agentSession: any,
  linearClient: LinearClient,
  sessionId: string,
  previousComments?: any[]
) {
  console.log(`🎯 processAgentSessionWork ENTERED for session ${sessionId}`);

  const issue = agentSession.issue;

  // Get comprehensive issue context including all comments, description, labels, etc.
  const sourceCommentId =
    agentSession.sourceMetadata?.agentSessionMetadata?.sourceCommentId;

  const issueContext = await getIssueContext(
    linearClient,
    issue.identifier,
    sourceCommentId
  );

  // Build context message with comprehensive issue details
  let contextMessage = `You have been assigned to work on this Linear issue. Here's the complete context:\n\n`;
  contextMessage += issueContext;

  // Add specific triggering comment information if available
  if (agentSession.comment) {
    const comment = agentSession.comment;
    const user = comment.user;
    const userName = user?.name || 'Unknown';
    contextMessage += `\n\n=== IMMEDIATE TRIGGER ===\nThis agent session was triggered by a comment from ${userName}: ${comment.body}`;
  }

  contextMessage += `\n\nPlease analyze this issue thoroughly and take appropriate actions. You can use Linear, GitHub, or Slack tools as needed.`;

  // Log that we're starting AI processing
  console.log(
    `Processing AI response for session ${sessionId}, issue ${issue.identifier}`
  );
  await agentActivityDirect.thought(
    sessionId,
    `Analyzing issue context for ${issue.identifier} - ${issue.title}`
  );

  // Status update function with appropriate activity types
  const updateStatus = async (status: string) => {
    console.log(`Agent Session Status: ${status}`);

    // Map status updates to appropriate activity types
    if (
      status.includes('is searching') ||
      status.includes('is getting') ||
      status.includes('is creating')
    ) {
      // Extract action and parameter from status
      const actionMatch = status.match(/is (\w+)/);
      const action = actionMatch ? actionMatch[1] : 'processing';
      await agentActivityDirect.action(
        sessionId,
        action,
        status.replace(`is ${action}`, '').trim()
      );
    } else if (status.includes('completed') || status.includes('finished')) {
      await agentActivityDirect.response(sessionId, status);
    } else if (status.includes('error') || status.includes('failed')) {
      await agentActivityDirect.error(sessionId, status);
    } else {
      // Default to thought for other statuses
      await agentActivityDirect.thought(sessionId, status);
    }
  };

  try {
    console.log(`Calling generateResponse for session ${sessionId}`);

    // Generate response using AI
    const result = await generateResponse(
      [{ role: 'user', content: contextMessage }],
      updateStatus,
      linearClient,
      undefined, // No Slack context
      undefined, // No abort signal
      sessionId // Pass the agent session ID for automatic tool injection
    );

    console.log(
      `generateResponse completed for session ${sessionId}, result length: ${
        result?.length || 0
      }`
    );

    // Explicitly complete the Linear agent session now that work is done
    try {
      await linearAgentSessionManager.completeSession(sessionId);
      console.log(`Completed Linear agent session: ${sessionId}`);
    } catch (error) {
      console.error('Error completing Linear agent session:', error);
    }
  } catch (error) {
    console.error(`generateResponse failed for session ${sessionId}:`, error);
    await agentActivityDirect.error(
      sessionId,
      `Analysis failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    throw error;
  }
}

/**
 * Handle 'prompted' Agent Session Event - user sent new message
 * Triggered when user responds to agent or sends follow-up message
 *
 * CRITICAL: Must acknowledge within 5 seconds to avoid timeout
 */
async function handleAgentSessionPrompted(
  payload: any,
  linearClient: LinearClient
) {
  const { agentSession, agentActivity } = payload;
  const sessionId = agentSession.id;
  const issue = agentSession.issue;

  if (!issue) {
    console.error('Agent session prompted without an issue');
    return;
  }

  console.log(`Agent session prompted for issue ${issue.identifier}`);

  // Extract the user prompt from the agentActivity first
  let userPrompt = '';
  if (agentActivity && agentActivity.content?.type === 'prompt') {
    userPrompt = agentActivity.content.body;
    console.log(`📝 User prompt extracted from agentActivity: "${userPrompt}"`);
  }

  // Fallback to comment if no agentActivity prompt found
  if (!userPrompt && agentSession.comment?.body) {
    userPrompt = agentSession.comment.body;
    console.log(`📝 Using comment as prompt fallback: "${userPrompt}"`);
  }

  if (!userPrompt) {
    console.error('No user prompt found in agent session prompted event');
    console.log(
      'AgentActivity structure:',
      JSON.stringify(agentActivity, null, 2)
    );
    console.log('AgentSession comment:', agentSession.comment?.body);
    return;
  }

  // Check for /stop command
  if (userPrompt.trim().toLowerCase() === '/stop') {
    console.log(`🛑 Stop command received for session ${sessionId}`);

    // Abort any active session processing immediately
    const abortController = sessionAbortControllers.get(sessionId);
    if (abortController) {
      console.log(`🛑 Aborting active processing for session ${sessionId}`);
      abortController.abort();
      sessionAbortControllers.delete(sessionId);
    }

    // Send immediate response about stopping
    await agentActivityDirect.response(
      sessionId,
      '🛑 **Otron is immediately stopping all operations** as requested. Any ongoing tasks have been cancelled.'
    );

    // Complete the session
    try {
      await linearAgentSessionManager.completeSession(sessionId);
      console.log(
        `Completed Linear agent session after stop command: ${sessionId}`
      );
    } catch (error) {
      console.error('Error completing Linear agent session after stop:', error);
    }

    return;
  }

  // Check if there's already an active agent session for this issue
  const activeSessionId = await getActiveSessionForIssue(issue.id);

  if (activeSessionId && activeSessionId !== sessionId) {
    console.log(
      `Found active session ${activeSessionId} for issue ${issue.id}, ${
        userPrompt.trim().toLowerCase() === '/stop'
          ? 'stopping active session'
          : 'queuing this prompt'
      }`
    );

    // If this is a stop command, abort the active session instead of queuing
    if (userPrompt.trim().toLowerCase() === '/stop') {
      // Abort the active session processing immediately
      const abortController = sessionAbortControllers.get(activeSessionId);
      if (abortController) {
        console.log(
          `🛑 Aborting active session processing for ${activeSessionId}`
        );
        abortController.abort();
        sessionAbortControllers.delete(activeSessionId);
      }

      // Also send stop command to queue as fallback
      const stopMessage: QueuedMessage = {
        timestamp: Date.now(),
        type: 'stop',
        content: 'STOP_COMMAND',
        sessionId: sessionId,
        issueId: issue.id,
        metadata: {
          agentActivity,
          agentSession,
          originalSessionId: activeSessionId,
        },
      };

      await queueMessageForSession(activeSessionId, stopMessage);

      // Send immediate response about stopping
      await agentActivityDirect.response(
        sessionId,
        '🛑 **Otron is immediately stopping all operations** as requested. The active session has been terminated.'
      );

      return;
    }

    // IMMEDIATE ACKNOWLEDGMENT still required for non-stop commands
    await agentActivityDirect.thought(
      sessionId,
      `Prompt acknowledged - joining active analysis for ${issue.identifier}`
    );

    // Queue this prompt for the active session
    const queuedMessage: QueuedMessage = {
      timestamp: Date.now(),
      type: 'prompted',
      content: `User prompt: ${userPrompt}`,
      sessionId: sessionId,
      issueId: issue.id,
      metadata: {
        agentActivity,
        agentSession,
        previousComments: payload.previousComments,
      },
    };

    await queueMessageForSession(activeSessionId, queuedMessage);

    // Complete this session since it's been merged with the active one
    await agentActivityDirect.response(
      sessionId,
      `Prompt queued for active session ${activeSessionId}`
    );

    return;
  }

  // Register the existing session ID from webhook with the session manager
  linearAgentSessionManager.registerExistingSession(sessionId, issue.id);

  // IMMEDIATE ACKNOWLEDGMENT (within 5 seconds)
  await agentActivityDirect.thought(
    sessionId,
    `Processing user prompt for ${issue.identifier}`
  );

  // Return the async processing Promise for waitUntil to handle
  return processAgentSessionPromptWithErrorHandling(
    agentSession,
    userPrompt,
    linearClient,
    sessionId,
    payload.previousComments
  );
}

/**
 * Wrapper for async prompt processing with error handling that can be used by waitUntil
 */
async function processAgentSessionPromptWithErrorHandling(
  agentSession: any,
  userPrompt: string,
  linearClient: LinearClient,
  sessionId: string,
  previousComments?: any[]
): Promise<void> {
  try {
    console.log(`Starting async prompt processing for session ${sessionId}`);
    await processAgentSessionPrompt(
      agentSession,
      userPrompt,
      linearClient,
      sessionId,
      previousComments
    );
  } catch (error) {
    console.error('Error in async agent session prompt processing:', error);
    // Log error to Linear using the real session ID (using thought for less prominent logging)
    try {
      await agentActivityDirect.thought(
        sessionId,
        `❌ Prompt processing failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } catch (logError) {
      console.error('Failed to log prompt error to Linear:', logError);
    }
  }
}

/**
 * Process the agent session prompt asynchronously
 * This runs after webhook acknowledgment to avoid timeout issues
 */
async function processAgentSessionPrompt(
  agentSession: any,
  userPrompt: string,
  linearClient: LinearClient,
  sessionId: string,
  previousComments?: any[]
) {
  const issue = agentSession.issue;

  // Get comprehensive issue context including all comments, description, labels, etc.
  const sourceCommentId =
    agentSession.sourceMetadata?.agentSessionMetadata?.sourceCommentId;

  const issueContext = await getIssueContext(
    linearClient,
    issue.identifier,
    sourceCommentId
  );

  // Build context message with comprehensive issue details
  let contextMessage = `You are continuing work on this Linear issue. Here's the complete context:\n\n`;
  contextMessage += issueContext;
  contextMessage += `\n\n=== NEW USER PROMPT ===\n${userPrompt}`;
  contextMessage += `\n\nPlease respond to the user's prompt and take appropriate actions.`;

  // Log that we're starting AI processing
  console.log(
    `Processing AI prompt response for session ${sessionId}, issue ${issue.identifier}`
  );
  await agentActivityDirect.thought(
    sessionId,
    `Processing follow-up prompt for ${issue.identifier}`
  );

  // Status update function with appropriate activity types
  const updateStatus = async (status: string) => {
    console.log(`Agent Session Status: ${status}`);

    // Map status updates to appropriate activity types
    if (
      status.includes('is searching') ||
      status.includes('is getting') ||
      status.includes('is creating')
    ) {
      // Extract action and parameter from status
      const actionMatch = status.match(/is (\w+)/);
      const action = actionMatch ? actionMatch[1] : 'processing';
      await agentActivityDirect.action(
        sessionId,
        action,
        status.replace(`is ${action}`, '').trim()
      );
    } else if (status.includes('completed') || status.includes('finished')) {
      await agentActivityDirect.response(sessionId, status);
    } else if (status.includes('error') || status.includes('failed')) {
      await agentActivityDirect.error(sessionId, status);
    } else {
      // Default to thought for other statuses
      await agentActivityDirect.thought(sessionId, status);
    }
  };

  try {
    console.log(`Calling generateResponse for prompt session ${sessionId}`);

    // Generate response using AI
    const result = await generateResponse(
      [{ role: 'user', content: contextMessage }],
      updateStatus,
      linearClient,
      undefined, // No Slack context
      undefined, // No abort signal
      sessionId // Pass the agent session ID for automatic tool injection
    );

    console.log(
      `generateResponse completed for prompt session ${sessionId}, result length: ${
        result?.length || 0
      }`
    );

    // Explicitly complete the Linear agent session now that work is done
    try {
      await linearAgentSessionManager.completeSession(sessionId);
      console.log(`Completed Linear agent session: ${sessionId}`);
    } catch (error) {
      console.error('Error completing Linear agent session:', error);
    }
  } catch (error) {
    console.error(
      `generateResponse failed for prompt session ${sessionId}:`,
      error
    );
    await agentActivityDirect.error(
      sessionId,
      `Follow-up analysis failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    throw error;
  }
}
