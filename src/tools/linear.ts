import { LinearService } from '../linear';

export const getIssueTool = {
  name: 'getIssue',
  description: 'Get the details of a specific Linear issue by ID',
  parameters: {
    type: 'object',
    required: ['issueId'],
    properties: {
      issueId: {
        type: 'string',
        description: 'The ID of the issue to retrieve (e.g., "OTR-123")'
      }
    }
  },
  handler: async (params: { issueId: string }) => {
    const { issueId } = params;
    const issue = await linear.getIssue(issueId);
    return issue;
  }
};