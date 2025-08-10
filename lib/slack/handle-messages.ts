import type {
  AssistantThreadStartedEvent,
  GenericMessageEvent,
} from '@slack/web-api';
import {
  client,
  getThread,
  updateStatusUtil,
  getLinearClientForSlack,
} from './slack-utils.js';
import { generateResponse } from '../generate-response.js';
import {
  makeSlackContextId,
  startSlackSession,
  endSlackSession,
} from './session-manager.js';
import { setSuggestedPrompts } from './suggested-prompts.js';

export async function assistantThreadMessage(
  event: AssistantThreadStartedEvent,
) {
  const { channel_id, thread_ts } = event.assistant_thread;
  console.log(`Thread started: ${channel_id} ${thread_ts}`);
  console.log(JSON.stringify(event));

  // Set up suggested prompts without sending an automatic greeting
  await client.assistant.threads.setSuggestedPrompts({
    channel_id: channel_id,
    thread_ts: thread_ts,
    prompts: [
      {
        title: 'Get the weather',
        message: 'What is the current weather in London?',
      },
      {
        title: 'Get the news',
        message: 'What is the latest Premier League news from the BBC?',
      },
      {
        title: 'Linear context',
        message: 'Show me recent Linear issues',
      },
    ],
  });
}

export async function handleNewAssistantMessage(
  event: GenericMessageEvent,
  botUserId: string,
) {
  if (event.subtype === 'bot_message' || !event.user || event.user === botUserId) {
    return;
  }

  const channel = event.channel;
  const root = event.thread_ts || event.ts;
  const isFirst = !event.thread_ts || event.thread_ts === event.ts;

  if (isFirst) {
    const variant = channel.startsWith('D') ? 'dm' : 'thread';
    await setSuggestedPrompts(channel, root, variant);
  }

  if (!event.thread_ts) {
    // This is not a thread message, so we don't need to do anything else.
    return;
  }

  const { channel, thread_ts } = event;
  console.log(
    `[slack:handleNewAssistantMessage] Received event for ${channel}:${thread_ts}. Proceeding to generate response.`
  );

  // Get LinearClient for this Slack context
  const linearClient = await getLinearClientForSlack();

  // Prepare Slack context for the AI
  const slackContext = {
    channelId: channel,
    threadTs: thread_ts,
  };

  const updateStatus = updateStatusUtil(channel, thread_ts);
  await updateStatus('is thinking...');

  const contextId = makeSlackContextId(channel, thread_ts);
  const abortController = startSlackSession(contextId);

  const messages = await getThread(channel, thread_ts, botUserId);

  try {
    await generateResponse(
      messages,
      updateStatus,
      linearClient,
      slackContext,
      abortController.signal,
    );
  } finally {
    try {
      await updateStatus('');
    } catch {}
    endSlackSession(contextId, abortController);
  }
}
