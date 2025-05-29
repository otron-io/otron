import { generateResponse } from '../generate-response.js';
import { verifyRequest } from './slack-utils.js';

export interface SlackInteractivePayload {
  type: 'block_actions' | 'shortcut' | 'view_submission' | 'view_closed';
  user: {
    id: string;
    username: string;
    name: string;
    team_id: string;
  };
  api_app_id: string;
  token: string;
  container?: {
    type: string;
    message_ts: string;
  };
  trigger_id: string;
  team: {
    id: string;
    domain: string;
  };
  enterprise?: any;
  is_enterprise_install: boolean;
  channel?: {
    id: string;
    name: string;
  };
  message?: {
    type: string;
    subtype?: string;
    text: string;
    ts: string;
    username?: string;
    bot_id?: string;
    blocks?: any[];
  };
  response_url?: string;
  actions?: Array<{
    action_id: string;
    block_id: string;
    text: {
      type: string;
      text: string;
      emoji?: boolean;
    };
    value?: string;
    style?: string;
    type: string;
    action_ts: string;
  }>;
}

export async function handleSlackInteractive(
  payload: SlackInteractivePayload,
  botUserId: string
) {
  try {
    console.log('Handling Slack interactive payload:', payload.type);

    // Handle different types of interactive components
    if (payload.type === 'block_actions') {
      await handleBlockActions(payload, botUserId);
    } else if (payload.type === 'shortcut') {
      await handleShortcut(payload, botUserId);
    } else if (payload.type === 'view_submission') {
      await handleViewSubmission(payload, botUserId);
    } else {
      console.log(`Unhandled interactive payload type: ${payload.type}`);
    }
  } catch (error) {
    console.error('Error handling Slack interactive payload:', error);
  }
}

async function handleBlockActions(
  payload: SlackInteractivePayload,
  botUserId: string
) {
  if (!payload.actions || payload.actions.length === 0) {
    console.log('No actions found in block_actions payload');
    return;
  }

  const action = payload.actions[0]; // Handle the first action
  const user = payload.user;
  const channel = payload.channel;
  const message = payload.message;
  const responseUrl = payload.response_url;

  // Build context message for the AI
  let contextMessage = `User ${user.name} (${user.username}) clicked a button in Slack.`;

  if (channel) {
    contextMessage += `\nChannel: ${channel.name} (${channel.id})`;
  }

  if (action) {
    contextMessage += `\nButton clicked: "${action.text.text}" (action_id: ${action.action_id})`;
    if (action.value) {
      contextMessage += `\nButton value: ${action.value}`;
    }
  }

  if (message) {
    contextMessage += `\nOriginal message timestamp: ${message.ts}`;
    if (message.text) {
      contextMessage += `\nOriginal message text: ${message.text}`;
    }
  }

  if (responseUrl) {
    contextMessage += `\nResponse URL available: ${responseUrl}`;
    contextMessage += `\nYou can use the respondToSlackInteraction tool with this URL to respond directly to the button click.`;
  }

  contextMessage += `\n\nPlease respond appropriately to this button click. You can:`;
  contextMessage += `\n- Use respondToSlackInteraction to update/replace the original message`;
  contextMessage += `\n- Use respondToSlackInteraction to send an ephemeral response only visible to the user`;
  contextMessage += `\n- Use regular Slack messaging tools to send new messages`;
  contextMessage += `\n- Take any other relevant action using your available tools if thats what the interaction indicates`;

  // Simple status update function for logging
  const updateStatus = (status: string) => {
    console.log(`Status update: ${status}`);
  };

  // Build Slack context for the generateResponse function
  const slackContext = channel
    ? {
        channelId: channel.id,
        threadTs: message?.ts, // Use message timestamp as thread context
      }
    : undefined;

  // Generate response using AI - let it decide how to respond
  await generateResponse(
    [{ role: 'user', content: contextMessage }],
    updateStatus,
    undefined, // No Linear client for Slack interactions
    slackContext
  );
}

async function handleShortcut(
  payload: SlackInteractivePayload,
  botUserId: string
) {
  // Handle global shortcuts or message shortcuts
  console.log('Handling shortcut:', payload);

  // For now, just log - can be extended later
  console.log('Shortcut handling not yet implemented');
}

async function handleViewSubmission(
  payload: SlackInteractivePayload,
  botUserId: string
) {
  // Handle modal submissions
  console.log('Handling view submission:', payload);

  // For now, just log - can be extended later
  console.log('View submission handling not yet implemented');
}
