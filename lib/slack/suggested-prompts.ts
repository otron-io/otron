import { WebClient } from '@slack/web-api';
import { getClient }from './slack-utils';

const genericPrompts = [
  'Summarize what you can do for me here',
  'Draft a status update for my team from this thread',
  'Create a Linear issue from our plan',
  'Open a GitHub issue for this bug',
  'Search our codebase for <thing>',
  'Review PR #<number> and suggest changes',
  'Do a quick research scan on <topic> with sources',
];

const threadPrompts = [
  'Summarize this thread so far',
  'Turn this into a Linear issue with acceptance criteria',
  'Draft a reply I can post',
  'Open a GitHub issue and link this thread',
  'List action items with owners from this discussion',
];

export async function setSuggestedPrompts(channel: string, ts: string, variant: 'dm' | 'thread') {
  const prompts = variant === 'dm' ? genericPrompts : threadPrompts;
  const client = getClient();

  const blocks = [
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'Try asking me:',
        },
      ],
    },
    {
      type: 'actions',
      elements: prompts.map((prompt) => ({
        type: 'button',
        text: {
          type: 'plain_text',
          text: prompt,
        },
        value: prompt,
      })),
    },
  ];

  console.log(`Setting suggested prompts for channel ${channel}, thread ${ts}`, { prompts });

  await client.chat.postMessage({
    channel,
    thread_ts: ts,
    blocks,
    text: 'Suggested prompts',
  });
}
