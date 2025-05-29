import type { SlackEvent } from '@slack/web-api';
import {
  assistantThreadMessage,
  handleNewAssistantMessage,
} from '../lib/slack/handle-messages.js';
import { waitUntil } from '@vercel/functions';
import { handleNewAppMention } from '../lib/slack/handle-app-mention.js';
import { verifyRequest, getBotId } from '../lib/slack/slack-utils.js';
import {
  handleSlackInteractive,
  type SlackInteractivePayload,
} from '../lib/slack/handle-interactive.js';

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') || '';

  // First, let's determine what type of request this is by examining the payload structure
  // rather than relying solely on content type

  if (contentType.includes('application/x-www-form-urlencoded')) {
    // This could be an interactive payload, but let's verify it properly
    const formData = await request.formData();
    const payloadString = formData.get('payload') as string;

    if (payloadString) {
      try {
        const payload = JSON.parse(payloadString);
        // Verify this is actually a Slack interactive payload by checking required fields
        if (
          payload.type &&
          [
            'block_actions',
            'shortcut',
            'message_action',
            'view_submission',
            'view_closed',
          ].includes(payload.type)
        ) {
          return handleInteractivePayload(request, payloadString, payload);
        }
      } catch (error) {
        console.error('Invalid JSON in payload parameter:', error);
        return new Response('Invalid payload format', { status: 400 });
      }
    }

    // If we get here, it's form-urlencoded but not a valid Slack interactive payload
    return new Response('Invalid request format', { status: 400 });
  }

  // Handle regular Slack events (should be application/json)
  if (contentType.includes('application/json')) {
    return handleSlackEvents(request);
  }

  // Reject requests with unexpected content types
  return new Response('Unsupported content type', { status: 400 });
}

async function handleInteractivePayload(
  request: Request,
  payloadString: string,
  payload: SlackInteractivePayload
) {
  try {
    // Verify the request authenticity using Slack's signing secret
    await verifyRequest({
      requestType: 'interactive',
      request,
      rawBody: `payload=${encodeURIComponent(payloadString)}`,
    });

    const botUserId = await getBotId();

    // Handle the interactive payload asynchronously
    waitUntil(handleSlackInteractive(payload, botUserId));

    // Slack expects a 200 response within 3 seconds for interactive components
    return new Response('', { status: 200 });
  } catch (error) {
    console.error('Error handling interactive payload:', error);
    return new Response('Error handling interactive payload', { status: 500 });
  }
}

async function handleSlackEvents(request: Request) {
  const rawBody = await request.text();

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    console.error('Invalid JSON in request body:', error);
    return new Response('Invalid JSON', { status: 400 });
  }

  const requestType = payload.type as 'url_verification' | 'event_callback';

  // See https://api.slack.com/events/url_verification
  if (requestType === 'url_verification') {
    // Verify this is actually from Slack before responding to the challenge
    try {
      await verifyRequest({
        requestType: 'url_verification',
        request,
        rawBody,
      });
    } catch (error) {
      console.error('URL verification failed:', error);
      return new Response('Verification failed', { status: 401 });
    }
    return new Response(payload.challenge, { status: 200 });
  }

  // Verify all other event callbacks
  if (requestType === 'event_callback') {
    try {
      await verifyRequest({ requestType: 'event_callback', request, rawBody });
    } catch (error) {
      console.error('Event verification failed:', error);
      return new Response('Verification failed', { status: 401 });
    }

    const botUserId = await getBotId();
    const event = payload.event as SlackEvent;

    if (event.type === 'app_mention') {
      waitUntil(handleNewAppMention(event, botUserId));
    }

    if (event.type === 'assistant_thread_started') {
      waitUntil(assistantThreadMessage(event));
    }

    if (
      event.type === 'message' &&
      !event.subtype &&
      event.channel_type === 'im' &&
      !event.bot_id &&
      !event.bot_profile &&
      event.bot_id !== botUserId
    ) {
      waitUntil(handleNewAssistantMessage(event, botUserId));
    }

    return new Response('Success!', { status: 200 });
  }

  // Unknown request type
  return new Response('Unknown request type', { status: 400 });
}
