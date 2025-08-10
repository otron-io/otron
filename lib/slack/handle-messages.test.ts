import { describe, it, expect, vi, afterEach } from 'vitest';
import { assistantThreadMessage, handleNewAssistantMessage } from './handle-messages';
import { client } from './slack-utils';

vi.mock('./slack-utils', () => ({
  client: {
    assistant: {
      threads: {
        setSuggestedPrompts: vi.fn(),
      },
    },
  },
  getThread: vi.fn(),
  updateStatusUtil: vi.fn(() => vi.fn()),
  getLinearClientForSlack: vi.fn(),
}));

vi.mock('../generate-response', () => ({
  generateResponse: vi.fn(),
}));

describe('Slack Message Handlers', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('assistantThreadMessage', () => {
    it('should set suggested prompts for a new DM thread', async () => {
      const event = {
        assistant_thread: {
          channel_id: 'D12345',
          thread_ts: '12345.67890',
        },
      };
      await assistantThreadMessage(event as any);
      expect(client.assistant.threads.setSuggestedPrompts).toHaveBeenCalledWith({
        channel_id: 'D12345',
        thread_ts: '12345.67890',
        prompts: expect.any(Array),
      });
    });

    it('should not set suggested prompts for a channel thread', async () => {
      const event = {
        assistant_thread: {
          channel_id: 'C12345',
          thread_ts: '12345.67890',
        },
      };
      await assistantThreadMessage(event as any);
      expect(client.assistant.threads.setSuggestedPrompts).not.toHaveBeenCalled();
    });
  });

  describe('handleNewAssistantMessage', () => {
    it('should not do anything for bot messages', async () => {
      const event = {
        subtype: 'bot_message',
      };
      await handleNewAssistantMessage(event as any, 'B012345');
      expect(client.assistant.threads.setSuggestedPrompts).not.toHaveBeenCalled();
    });

    it('should not do anything for messages without a thread_ts', async () => {
        const event = {
            user: 'U12345',
            channel: 'C12345',
            ts: '12345.67890',
        };
        await handleNewAssistantMessage(event as any, 'B012345');
        expect(client.assistant.threads.setSuggestedPrompts).not.toHaveBeenCalled();
    });
  });
});