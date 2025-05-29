import { openai } from '@ai-sdk/openai';
import { CoreMessage, generateText, tool } from 'ai';
import { z } from 'zod';
import { exa } from './utils.js';
import * as linearUtils from './linear-utils.js';

// Tool execution functions
const executeGetWeather = async (
  {
    latitude,
    longitude,
    city,
  }: { latitude: number; longitude: number; city: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is getting weather for ${city}...`);

  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weathercode,relativehumidity_2m&timezone=auto`
  );

  const weatherData = await response.json();
  return {
    temperature: weatherData.current.temperature_2m,
    weatherCode: weatherData.current.weathercode,
    humidity: weatherData.current.relativehumidity_2m,
    city,
  };
};

const executeSearchWeb = async (
  { query, specificDomain }: { query: string; specificDomain: string | null },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is searching the web for ${query}...`);
  const { results } = await exa.searchAndContents(query, {
    livecrawl: 'always',
    numResults: 3,
    includeDomains: specificDomain ? [specificDomain] : undefined,
  });

  return {
    results: results.map((result: any) => ({
      title: result.title,
      url: result.url,
      snippet: result.text.slice(0, 1000),
    })),
  };
};

// Linear tool execution functions
const executeGetIssueContext = async (
  { issueId, commentId }: { issueId: string; commentId?: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is getting context for issue ${issueId}...`);

  const context = await linearUtils.getIssueContext(issueId, commentId);
  return { context };
};

const executeUpdateIssueStatus = async (
  { issueId, statusName }: { issueId: string; statusName: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is updating status of issue ${issueId} to ${statusName}...`);

  await linearUtils.updateIssueStatus(issueId, statusName);
  return {
    success: true,
    message: `Updated issue ${issueId} status to ${statusName}`,
  };
};

const executeAddLabel = async (
  { issueId, labelName }: { issueId: string; labelName: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is adding label ${labelName} to issue ${issueId}...`);

  await linearUtils.addLabel(issueId, labelName);
  return {
    success: true,
    message: `Added label ${labelName} to issue ${issueId}`,
  };
};

const executeRemoveLabel = async (
  { issueId, labelName }: { issueId: string; labelName: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is removing label ${labelName} from issue ${issueId}...`);

  await linearUtils.removeLabel(issueId, labelName);
  return {
    success: true,
    message: `Removed label ${labelName} from issue ${issueId}`,
  };
};

const executeAssignIssue = async (
  { issueId, assigneeEmail }: { issueId: string; assigneeEmail: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is assigning issue ${issueId} to ${assigneeEmail}...`);

  await linearUtils.assignIssue(issueId, assigneeEmail);
  return {
    success: true,
    message: `Assigned issue ${issueId} to ${assigneeEmail}`,
  };
};

const executeCreateIssue = async (
  {
    teamId,
    title,
    description,
    status,
    priority,
    parentIssueId,
  }: {
    teamId: string;
    title: string;
    description: string;
    status?: string;
    priority?: number;
    parentIssueId?: string;
  },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is creating new issue "${title}"...`);

  await linearUtils.createIssue(
    teamId,
    title,
    description,
    status,
    priority,
    parentIssueId
  );
  return { success: true, message: `Created new issue: ${title}` };
};

const executeAddIssueAttachment = async (
  { issueId, url, title }: { issueId: string; url: string; title: string },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is adding attachment "${title}" to issue ${issueId}...`);

  await linearUtils.addIssueAttachment(issueId, url, title);
  return {
    success: true,
    message: `Added attachment "${title}" to issue ${issueId}`,
  };
};

const executeUpdateIssuePriority = async (
  { issueId, priority }: { issueId: string; priority: number },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(`is updating priority of issue ${issueId} to ${priority}...`);

  await linearUtils.updateIssuePriority(issueId, priority);
  return {
    success: true,
    message: `Updated issue ${issueId} priority to ${priority}`,
  };
};

const executeSetPointEstimate = async (
  { issueId, pointEstimate }: { issueId: string; pointEstimate: number },
  updateStatus?: (status: string) => void
) => {
  updateStatus?.(
    `is setting point estimate of issue ${issueId} to ${pointEstimate}...`
  );

  await linearUtils.setPointEstimate(issueId, pointEstimate);
  return {
    success: true,
    message: `Set point estimate for issue ${issueId} to ${pointEstimate}`,
  };
};

export const generateResponse = async (
  messages: CoreMessage[],
  updateStatus?: (status: string) => void
) => {
  const { text } = await generateText({
    model: openai('o4-mini'),
    system: `You are Otron. An omnipresent AI agent. You exist across Slack, Linear, and GitHub.
    - You keep your responses concise and to the point, but friendly and engaging while being as helpful as possible.
    - You can be notified to take action via all 3 platforms, and can take actions on all 3 platforms.
    - You must decide where to respond. For example, if you are asked in Slack to take action on Linear, you should respond in Slack while also taking action on Linear.

    Final notes:
    - Current date is: ${new Date().toISOString().split('T')[0]}
    - Make sure to ALWAYS include sources in your final response if you use web search. Put sources inline if possible.`,
    messages,
    maxSteps: 10,
    tools: {
      getWeather: tool({
        description: 'Get the current weather at a location',
        parameters: z.object({
          latitude: z.number(),
          longitude: z.number(),
          city: z.string(),
        }),
        execute: (params) => executeGetWeather(params, updateStatus),
      }),
      searchWeb: tool({
        description: 'Use this to search the web for information',
        parameters: z.object({
          query: z.string(),
          specificDomain: z
            .string()
            .nullable()
            .describe(
              'a domain to search if the user specifies e.g. bbc.com. Should be only the domain name without the protocol'
            ),
        }),
        execute: (params) => executeSearchWeb(params, updateStatus),
      }),
      getIssueContext: tool({
        description:
          'Get the context for a Linear issue including comments, child issues, and parent issue',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID or identifier'),
          commentId: z
            .string()
            .optional()
            .describe('Optional comment ID to highlight'),
        }),
        execute: (params) => executeGetIssueContext(params, updateStatus),
      }),
      updateIssueStatus: tool({
        description: 'Update the status of a Linear issue',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID or identifier'),
          statusName: z
            .string()
            .describe(
              'The name of the status to set (e.g., "In Progress", "Done")'
            ),
        }),
        execute: (params) => executeUpdateIssueStatus(params, updateStatus),
      }),
      addLabel: tool({
        description: 'Add a label to a Linear issue',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID'),
          labelName: z.string().describe('The name of the label to add'),
        }),
        execute: (params) => executeAddLabel(params, updateStatus),
      }),
      removeLabel: tool({
        description: 'Remove a label from a Linear issue',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID'),
          labelName: z.string().describe('The name of the label to remove'),
        }),
        execute: (params) => executeRemoveLabel(params, updateStatus),
      }),
      assignIssue: tool({
        description: 'Assign a Linear issue to a team member',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID'),
          assigneeEmail: z
            .string()
            .describe('The email address of the person to assign the issue to'),
        }),
        execute: (params) => executeAssignIssue(params, updateStatus),
      }),
      createIssue: tool({
        description: 'Create a new Linear issue',
        parameters: z.object({
          teamId: z.string().describe('The Linear team ID'),
          title: z.string().describe('The title of the new issue'),
          description: z.string().describe('The description of the new issue'),
          status: z
            .string()
            .optional()
            .describe('Optional status name for the new issue'),
          priority: z
            .number()
            .optional()
            .describe('Optional priority level (1-4, where 1 is highest)'),
          parentIssueId: z
            .string()
            .optional()
            .describe('Optional parent issue ID to create this as a subtask'),
        }),
        execute: (params) => executeCreateIssue(params, updateStatus),
      }),
      addIssueAttachment: tool({
        description: 'Add a URL attachment to a Linear issue',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID'),
          url: z.string().describe('The URL to attach'),
          title: z.string().describe('The title for the attachment'),
        }),
        execute: (params) => executeAddIssueAttachment(params, updateStatus),
      }),
      updateIssuePriority: tool({
        description: 'Update the priority of a Linear issue',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID or identifier'),
          priority: z
            .number()
            .describe('The priority level (1-4, where 1 is highest)'),
        }),
        execute: (params) => executeUpdateIssuePriority(params, updateStatus),
      }),
      setPointEstimate: tool({
        description: 'Set the point estimate for a Linear issue',
        parameters: z.object({
          issueId: z.string().describe('The Linear issue ID or identifier'),
          pointEstimate: z.number().describe('The point estimate value'),
        }),
        execute: (params) => executeSetPointEstimate(params, updateStatus),
      }),
    },
  });

  return text;
};
