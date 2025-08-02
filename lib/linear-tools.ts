import * as linearUtils from './linear/linear-utils.js';
import { LinearClient } from '@linear/sdk';
import { agentActivity } from './linear/linear-agent-session-manager.js';

// Linear tool execution functions

export const executeGetIssueContext = async (
  { issueId, commentId }: { issueId: string; commentId: string },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      context:
        'ERROR: LinearClient is required for Linear operations. Please ensure Linear integration is properly configured.',
      error: 'LinearClient not available',
    };
  }

  updateStatus?.(`is getting context for issue ${issueId}...`);

  const context = await linearUtils.getIssueContext(
    linearClient,
    issueId,
    commentId || undefined
  );
  return { context };
};

export const executeUpdateIssueStatus = async (
  { issueId, statusName }: { issueId: string; statusName: string },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      success: false,
      error: 'LinearClient is required for Linear operations',
      message: 'Failed to update issue status: Linear client not available',
    };
  }

  updateStatus?.(`is updating issue ${issueId} status to ${statusName}...`);

  await linearUtils.updateIssueStatus(linearClient, issueId, statusName);
  return {
    success: true,
    message: `Updated issue ${issueId} status to ${statusName}`,
  };
};

export const executeAddLabel = async (
  { issueId, labelName }: { issueId: string; labelName: string },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      success: false,
      error: 'LinearClient is required for Linear operations',
      message: 'Failed to add label: Linear client not available',
    };
  }

  updateStatus?.(`is adding label ${labelName} to issue ${issueId}...`);

  await linearUtils.addLabel(linearClient, issueId, labelName);
  return {
    success: true,
    message: `Added label ${labelName} to issue ${issueId}`,
  };
};

export const executeRemoveLabel = async (
  { issueId, labelName }: { issueId: string; labelName: string },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      success: false,
      error: 'LinearClient is required for Linear operations',
      message: 'Failed to remove label: Linear client not available',
    };
  }

  updateStatus?.(`is removing label ${labelName} from issue ${issueId}...`);

  await linearUtils.removeLabel(linearClient, issueId, labelName);
  return {
    success: true,
    message: `Removed label ${labelName} from issue ${issueId}`,
  };
};

export const executeAssignIssue = async (
  { issueId, assigneeEmail }: { issueId: string; assigneeEmail: string },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      success: false,
      error: 'LinearClient is required for Linear operations',
      message: 'Failed to assign issue: Linear client not available',
    };
  }

  updateStatus?.(`is assigning issue ${issueId} to ${assigneeEmail}...`);

  await linearUtils.assignIssue(linearClient, issueId, assigneeEmail);
  return {
    success: true,
    message: `Assigned issue ${issueId} to ${assigneeEmail}`,
  };
};

export const executeCreateIssue = async (
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
    status: string;
    priority: number;
    parentIssueId: string;
  },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      success: false,
      error: 'LinearClient is required for Linear operations',
      message: 'Failed to create issue: Linear client not available',
    };
  }

  updateStatus?.(`is creating new issue "${title}"...`);

  // Add strategic thinking about issue creation
  await agentActivity.thought(
    'system',
    `Issue creation strategy: Creating "${title}" in team ${teamId}${
      parentIssueId ? ` as child of ${parentIssueId}` : ''
    }. Priority: ${priority || 'default'}, Status: ${
      status || 'default'
    }. Description length: ${description.length} chars.`
  );

  const result = await linearUtils.createIssue(
    linearClient,
    teamId,
    title,
    description,
    status || undefined,
    priority === 0 ? undefined : priority,
    parentIssueId || undefined
  );

  return result;
};

export const executeAddIssueAttachment = async (
  { issueId, url, title }: { issueId: string; url: string; title: string },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      success: false,
      error: 'LinearClient is required for Linear operations',
      message: 'Failed to add attachment: Linear client not available',
    };
  }

  updateStatus?.(`is adding attachment "${title}" to issue ${issueId}...`);

  await linearUtils.addIssueAttachment(linearClient, issueId, url, title);
  return {
    success: true,
    message: `Added attachment "${title}" to issue ${issueId}`,
  };
};

export const executeUpdateIssuePriority = async (
  { issueId, priority }: { issueId: string; priority: number },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      success: false,
      error: 'LinearClient is required for Linear operations',
      message: 'Failed to update priority: Linear client not available',
    };
  }

  updateStatus?.(`is updating issue ${issueId} priority to ${priority}...`);

  await linearUtils.updateIssuePriority(linearClient, issueId, priority);
  return {
    success: true,
    message: `Updated issue ${issueId} priority to ${priority}`,
  };
};

export const executeSetPointEstimate = async (
  { issueId, pointEstimate }: { issueId: string; pointEstimate: number },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      success: false,
      error: 'LinearClient is required for Linear operations',
      message: 'Failed to set point estimate: Linear client not available',
    };
  }

  updateStatus?.(
    `is setting point estimate for issue ${issueId} to ${pointEstimate}...`
  );

  await linearUtils.setPointEstimate(linearClient, issueId, pointEstimate);
  return {
    success: true,
    message: `Set point estimate for issue ${issueId} to ${pointEstimate}`,
  };
};

// Linear context gathering tool execution functions
export const executeGetLinearTeams = async (
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  updateStatus?.('is getting Linear teams...');

  if (!linearClient) {
    return { error: 'Linear client not available' };
  }

  const teams = await linearUtils.getTeams(linearClient);
  return { teams };
};

export const executeGetLinearProjects = async (
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  updateStatus?.('is getting Linear projects...');

  if (!linearClient) {
    return { error: 'Linear client not available' };
  }

  const projects = await linearUtils.getProjects(linearClient);
  return { projects };
};

export const executeGetLinearInitiatives = async (
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  updateStatus?.('is getting Linear initiatives...');

  if (!linearClient) {
    return { error: 'Linear client not available' };
  }

  const initiatives = await linearUtils.getInitiatives(linearClient);
  return { initiatives };
};

export const executeGetLinearUsers = async (
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  updateStatus?.('is getting Linear users...');

  if (!linearClient) {
    return { error: 'Linear client not available' };
  }

  const users = await linearUtils.getUsers(linearClient);
  return { users };
};

export const executeGetLinearRecentIssues = async (
  { limit, teamId }: { limit: number; teamId: string },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  updateStatus?.(
    `is getting recent Linear issues${teamId ? ` for team ${teamId}` : ''}...`
  );

  if (!linearClient) {
    return { error: 'Linear client not available' };
  }

  const issues = await linearUtils.getRecentIssues(
    linearClient,
    limit || 20,
    teamId || undefined
  );
  return { issues };
};

export const executeSearchLinearIssues = async (
  { query, limit }: { query: string; limit: number },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  updateStatus?.(`is searching Linear issues for "${query}"...`);

  if (!linearClient) {
    return { error: 'Linear client not available' };
  }

  const issues = await linearUtils.searchIssues(
    linearClient,
    query,
    limit || 10
  );
  return { issues };
};

export const executeGetLinearWorkflowStates = async (
  { teamId }: { teamId: string },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  updateStatus?.(
    `is getting Linear workflow states${teamId ? ` for team ${teamId}` : ''}...`
  );

  if (!linearClient) {
    return { error: 'Linear client not available' };
  }

  const workflowStates = await linearUtils.getWorkflowStates(
    linearClient,
    teamId || undefined
  );
  return { workflowStates };
};

export const executeCreateLinearComment = async (
  { issueId, body }: { issueId: string; body: string },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      success: false,
      error: 'LinearClient is required for Linear operations',
      message: 'Failed to create comment: Linear client not available',
    };
  }

  updateStatus?.(`is creating comment on issue ${issueId}...`);

  await linearUtils.createComment(linearClient, issueId, body);
  return {
    success: true,
    message: `Created comment on issue ${issueId}`,
  };
};

export const executeCreateAgentActivity = async (
  {
    sessionId,
    activityType,
    body,
    action,
    parameter,
    result,
  }: {
    sessionId: string;
    activityType: 'thought' | 'elicitation' | 'action' | 'response' | 'error';
    body: string;
    action: string;
    parameter: string;
    result: string;
  },
  updateStatus?: (status: string) => void,
  linearClient?: LinearClient
) => {
  if (!linearClient) {
    return {
      success: false,
      error: 'LinearClient is required for Linear operations',
      message: 'Failed to create agent activity: Linear client not available',
    };
  }

  updateStatus?.(`is creating ${activityType} activity...`);

  try {
    // Build the content object based on activity type
    let content: any = { type: activityType };

    switch (activityType) {
      case 'thought':
      case 'elicitation':
      case 'response':
      case 'error':
        if (!body || body.trim() === '') {
          return {
            success: false,
            error: `Body is required for ${activityType} activities`,
            message: `Failed to create ${activityType} activity: Missing body`,
          };
        }
        content.body = body;
        break;

      case 'action':
        if (
          !action ||
          action.trim() === '' ||
          !parameter ||
          parameter.trim() === ''
        ) {
          return {
            success: false,
            error: 'Action and parameter are required for action activities',
            message:
              'Failed to create action activity: Missing action or parameter',
          };
        }
        content.action = action;
        content.parameter = parameter;
        if (result && result.trim() !== '') {
          content.result = result;
        }
        break;
    }

    // Create the agent activity using direct GraphQL mutation
    // Note: Using direct HTTP request since createAgentActivity is not available in SDK version 39.1.1
    const mutation = `
      mutation AgentActivityCreate($input: AgentActivityCreateInput!) {
        agentActivityCreate(input: $input) {
          success
          agentActivity {
            id
          }
        }
      }
    `;

    const variables = {
      input: {
        agentSessionId: sessionId,
        content: content,
      },
    };

    // Use fetch to make direct GraphQL request to Linear API
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${
          (linearClient as any).accessToken || (linearClient as any).token
        }`,
      },
      body: JSON.stringify({
        query: mutation,
        variables: variables,
      }),
    });

    const data = await response.json();

    if (data.data?.agentActivityCreate?.success) {
      return {
        success: true,
        message: `Created ${activityType} activity for session ${sessionId}`,
        activityId: data.data.agentActivityCreate?.agentActivity?.id,
      };
    } else {
      return {
        success: false,
        error: data.errors?.[0]?.message || 'Failed to create agent activity',
        message: `Linear API rejected the ${activityType} activity: ${
          data.errors?.[0]?.message || 'Unknown error'
        }`,
      };
    }
  } catch (error: unknown) {
    console.error(`Error creating agent activity:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      message: `Failed to create ${activityType} activity: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
};
