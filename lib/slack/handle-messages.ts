import type {
  AssistantThreadStartedEvent,
  GenericMessageEvent,
} from '@slack/web-api';
import {
  client,
  getThread,
  sendMessage,
  updateStatusUtil,
  getLinearClientForSlack,
} from './slack-utils.js';
import { generateResponse } from '../generate-response.js';

export async function assistantThreadMessage(
  event: AssistantThreadStartedEvent
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
  botUserId: string
) {
  if (
    event.bot_id ||
    event.bot_id === botUserId ||
    event.bot_profile ||
    !event.thread_ts
  )
    return;

  const { channel, thread_ts } = event;

  // Get LinearClient for this Slack context
  const linearClient = await getLinearClientForSlack();

  // Prepare Slack context for the AI
  const slackContext = {
    channelId: channel,
    threadTs: thread_ts,
  };

  const updateStatus = updateStatusUtil(channel, thread_ts);
  await updateStatus('is thinking...');

  const messages = await getThread(channel, thread_ts, botUserId);

  // Let the AI decide whether and how to respond using its tools
  await generateResponse(messages, updateStatus, linearClient, slackContext);

  await updateStatus('');
}
