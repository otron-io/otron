import { http, HttpResponse } from 'msw';

export const mswHandlers = [
  // Linear API mocks
  http.post('https://api.linear.app/graphql', () => {
    return HttpResponse.json({
      data: {
        issues: {
          nodes: [
            {
              id: 'test-issue-id',
              identifier: 'TEST-123',
              title: 'Test Issue',
              description: 'Test issue description',
              state: {
                name: 'Todo',
              },
            },
          ],
        },
      },
    });
  }),

  // GitHub API mocks
  http.get('https://api.github.com/repos/:owner/:repo/contents/:path', () => {
    return HttpResponse.json({
      name: 'test-file.ts',
      path: 'test-file.ts',
      content: Buffer.from('console.log("test")').toString('base64'),
      encoding: 'base64',
      size: 20,
      type: 'file',
    });
  }),

  http.post('https://api.github.com/repos/:owner/:repo/pulls', () => {
    return HttpResponse.json({
      id: 123,
      number: 456,
      title: 'Test PR',
      html_url: 'https://github.com/test/repo/pull/456',
    });
  }),

  // Slack API mocks
  http.post('https://slack.com/api/chat.postMessage', () => {
    return HttpResponse.json({
      ok: true,
      channel: 'C1234567890',
      ts: '1234567890.123456',
      message: {
        text: 'Test message',
      },
    });
  }),

  // OpenAI API mocks
  http.post('https://api.openai.com/v1/chat/completions', () => {
    return HttpResponse.json({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: Date.now(),
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Test response from OpenAI',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    });
  }),

  // Exa API mocks
  http.post('https://api.exa.ai/search', () => {
    return HttpResponse.json({
      results: [
        {
          id: 'test-result-1',
          title: 'Test Search Result',
          url: 'https://example.com/test',
          text: 'Test search result content',
          score: 0.95,
        },
      ],
      autopromptString: 'Test search query',
    });
  }),

  // Redis/Upstash mocks (for KV operations)
  http.post('https://*/get/*', () => {
    return HttpResponse.json({
      result: null,
    });
  }),

  http.post('https://*/set/*', () => {
    return HttpResponse.json({
      result: 'OK',
    });
  }),

  http.post('https://*/del/*', () => {
    return HttpResponse.json({
      result: 1,
    });
  }),

  // Fallback for unhandled requests
  http.all('*', ({ request }) => {
    console.warn(`Unhandled ${request.method} request to ${request.url}`);
    return new HttpResponse(null, { status: 404 });
  }),
];
