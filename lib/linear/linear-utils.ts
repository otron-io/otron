import { LinearClient } from '@linear/sdk';

/**
 * Get the context for an issue including comments, child issues, and parent issue
 */
export const getIssueContext = async (
  linearClient: LinearClient,
  issueIdOrIdentifier: string,
  commentId?: string
): Promise<string> => {
  const issue = await linearClient.issue(issueIdOrIdentifier);
  if (!issue) {
    throw new Error(`Issue ${issueIdOrIdentifier} not found`);
  }

  // Mark this as the assigned issue
  let context = `>>>>> ASSIGNED/TAGGED ISSUE <<<<<\n`;
  context += `ISSUE ${issue.identifier}: ${issue.title}\n`;
  context += `DESCRIPTION: ${
    issue.description || 'No description provided'
  }\n\n`;

  // Add comments
  const comments = await issue.comments({ first: 10 });
  if (comments.nodes.length > 0) {
    context += 'RECENT COMMENTS:\n';

    for (const comment of comments.nodes) {
      // If this is the triggering comment, highlight it
      const isTriggering = commentId && comment.id === commentId;
      const prefix = isTriggering ? '► ' : '';

      // Add user info if available
      let userName = 'Unknown';
      if (comment.user) {
        try {
          const user = await comment.user;
          userName = user ? user.name || 'Unknown' : 'Unknown';
        } catch (e) {
          console.error('Error getting user name:', e);
        }
      }

      context += `${prefix}${userName}: ${comment.body}\n\n`;
    }
  }

  // Add labels if any
  const labels = await issue.labels();
  if (labels.nodes.length > 0) {
    const labelNames = labels.nodes.map((l: any) => l.name).join(', ');
    context += `LABELS: ${labelNames}\n`;
  }

  // Get parent issue if this is a child issue
  try {
    const parent = await issue.parent;
    if (parent) {
      context += `\n----- PARENT ISSUE (Context Only) -----\n`;
      context += `ISSUE ${parent.identifier}: ${parent.title}\n`;
      context += `DESCRIPTION: ${
        parent.description || 'No description provided'
      }\n`;

      // Add parent issue labels
      const parentLabels = await parent.labels();
      if (parentLabels.nodes.length > 0) {
        const labelNames = parentLabels.nodes
          .map((l: any) => l.name)
          .join(', ');
        context += `LABELS: ${labelNames}\n`;
      }
    }
  } catch (error) {
    console.error('Error getting parent issue:', error);
  }

  // Get child issues if any
  try {
    const children = await issue.children();
    if (children.nodes.length > 0) {
      context += `\n----- CHILD ISSUES (Context Only) -----\n`;

      for (const child of children.nodes) {
        context += `ISSUE ${child.identifier}: ${child.title}\n`;

        // Add status information for child issues
        const state = await child.state;
        if (state) {
          context += `STATUS: ${state.name}\n`;
        }

        // Add brief description (first 100 chars)
        if (child.description) {
          const briefDesc =
            child.description.length > 100
              ? `${child.description.substring(0, 100)}...`
              : child.description;
          context += `BRIEF: ${briefDesc}\n`;
        }

        context += `\n`;
      }
    }
  } catch (error) {
    console.error('Error getting child issues:', error);
  }

  return context;
};

/**
 * Update the status of a Linear issue
 */
export const updateIssueStatus = async (
  linearClient: LinearClient,
  issueIdOrIdentifier: string,
  statusName: string
): Promise<void> => {
  try {
    // Get all workflow states for the issue's team
    const issue = await linearClient.issue(issueIdOrIdentifier);
    if (!issue) {
      console.error(`Issue ${issueIdOrIdentifier} not found`);
      return;
    }

    const team = await issue.team;
    if (!team) {
      console.error(`Team not found for issue ${issueIdOrIdentifier}`);
      return;
    }

    const states = await linearClient.workflowStates({
      filter: {
        team: {
          id: { eq: team.id },
        },
      },
    });

    // Find the state with the matching name
    const state = states.nodes.find(
      (s: any) => s.name.toLowerCase() === statusName.toLowerCase()
    );

    if (!state) {
      console.error(
        `Status "${statusName}" not found for team ${
          team.name
        }. Available states: ${states.nodes.map((s: any) => s.name).join(', ')}`
      );
      return;
    }

    // Update the issue with the new state
    await issue.update({ stateId: state.id });

    console.log(`Updated issue ${issueIdOrIdentifier} status to ${statusName}`);
  } catch (error: unknown) {
    console.error(
      `Error updating status for issue ${issueIdOrIdentifier}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
};

/**
 * Add a label to a Linear issue
 */
export const addLabel = async (
  linearClient: LinearClient,
  issueId: string,
  labelName: string
): Promise<void> => {
  try {
    // Find the label by name
    const labelsResponse = await linearClient.issueLabels();
    const label = labelsResponse.nodes.find((l: any) => l.name === labelName);

    if (!label) {
      console.error(`Label "${labelName}" not found`);
      return;
    }

    // Add the label to the issue
    await linearClient.issueAddLabel(issueId, label.id);
    console.log(`Added label "${labelName}" to issue ${issueId}`);
  } catch (error: unknown) {
    console.error(
      `Error adding label "${labelName}" to issue ${issueId}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
};

/**
 * Remove a label from a Linear issue
 */
export const removeLabel = async (
  linearClient: LinearClient,
  issueId: string,
  labelName: string
): Promise<void> => {
  try {
    // Find the label by name
    const labelsResponse = await linearClient.issueLabels();
    const label = labelsResponse.nodes.find((l: any) => l.name === labelName);

    if (!label) {
      console.error(`Label "${labelName}" not found`);
      return;
    }

    // Remove the label from the issue
    await linearClient.issueRemoveLabel(issueId, label.id);
    console.log(`Removed label "${labelName}" from issue ${issueId}`);
  } catch (error: unknown) {
    console.error(
      `Error removing label "${labelName}" from issue ${issueId}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
};

/**
 * Assign a Linear issue to a team member
 */
export const assignIssue = async (
  linearClient: LinearClient,
  issueId: string,
  assigneeEmail: string
): Promise<void> => {
  try {
    // Find the user by email
    const usersResponse = await linearClient.users();
    const user = usersResponse.nodes.find(
      (user: any) => user.email === assigneeEmail
    );

    if (!user) {
      console.error(`User with email "${assigneeEmail}" not found`);
      return;
    }

    // Assign the issue to the user
    const issue = await linearClient.issue(issueId);
    await issue.update({ assigneeId: user.id });
    console.log(`Assigned issue ${issueId} to ${assigneeEmail}`);
  } catch (error: unknown) {
    console.error(
      `Error assigning issue ${issueId} to ${assigneeEmail}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
};

/**
 * Create a new Linear issue
 */
export const createIssue = async (
  linearClient: LinearClient,
  teamId: string,
  title: string,
  description: string,
  status?: string,
  priority?: number,
  parentIssueId?: string
): Promise<void> => {
  try {
    let stateId: string | undefined;

    // If status is provided, find the corresponding state
    if (status) {
      const states = await linearClient.workflowStates({
        filter: {
          team: {
            id: { eq: teamId },
          },
        },
      });

      const state = states.nodes.find(
        (state: any) => state.name.toLowerCase() === status.toLowerCase()
      );

      if (state) {
        stateId = state.id;
      } else {
        console.warn(`Status "${status}" not found, using default`);
      }
    }

    // Create the issue
    const issuePayload: any = {
      teamId,
      title,
      description,
    };

    if (stateId) {
      issuePayload.stateId = stateId;
    }

    if (priority) {
      issuePayload.priority = priority;
    }

    if (parentIssueId) {
      issuePayload.parentId = parentIssueId;
    }

    const newIssue = await linearClient.createIssue(issuePayload);
    const createdIssue = await newIssue.issue;
    console.log(`Created issue: ${createdIssue?.identifier}`);
  } catch (error: unknown) {
    console.error(
      'Error creating issue:',
      error instanceof Error ? error.message : String(error)
    );
  }
};

/**
 * Add a URL attachment to a Linear issue
 */
export const addIssueAttachment = async (
  linearClient: LinearClient,
  issueId: string,
  url: string,
  title: string
): Promise<void> => {
  try {
    await linearClient.createAttachment({
      issueId,
      url,
      title,
    });
    console.log(`Added attachment "${title}" to issue ${issueId}`);
  } catch (error: unknown) {
    console.error(
      `Error adding attachment to issue ${issueId}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
};

/**
 * Update the priority of a Linear issue
 */
export const updateIssuePriority = async (
  linearClient: LinearClient,
  issueIdOrIdentifier: string,
  priority: number
): Promise<void> => {
  try {
    const issue = await linearClient.issue(issueIdOrIdentifier);
    if (!issue) {
      console.error(`Issue ${issueIdOrIdentifier} not found`);
      return;
    }

    await issue.update({ priority });
    console.log(`Updated issue ${issueIdOrIdentifier} priority to ${priority}`);
  } catch (error: unknown) {
    console.error(
      `Error updating priority for issue ${issueIdOrIdentifier}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
};

/**
 * Set the point estimate for a Linear issue
 */
export const setPointEstimate = async (
  linearClient: LinearClient,
  issueIdOrIdentifier: string,
  pointEstimate: number
): Promise<void> => {
  try {
    const issue = await linearClient.issue(issueIdOrIdentifier);
    if (!issue) {
      console.error(`Issue ${issueIdOrIdentifier} not found`);
      return;
    }

    await issue.update({ estimate: pointEstimate });
    console.log(
      `Set point estimate for issue ${issueIdOrIdentifier} to ${pointEstimate}`
    );
  } catch (error: unknown) {
    console.error(
      `Error setting point estimate for issue ${issueIdOrIdentifier}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
};
