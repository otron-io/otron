import { LinearClient } from '@linear/sdk';

// Initialize Linear client
export const linearClient = new LinearClient({
  apiKey: process.env.LINEAR_API_KEY!,
});

/**
 * Get the context for an issue including comments, child issues, and parent issue
 */
export const getIssueContext = async (
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
      (s) => s.name.toLowerCase() === statusName.toLowerCase()
    );

    if (!state) {
      console.error(
        `Status "${statusName}" not found for team ${
          team.name
        }. Available states: ${states.nodes.map((s) => s.name).join(', ')}`
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
  issueId: string,
  labelName: string
): Promise<void> => {
  try {
    // Fetch the issue
    const issue = await linearClient.issue(issueId);

    // Get current labels for the issue
    const issueLabelsResponse = await issue.labels();

    // Find the label that matches the requested label name
    const label = issueLabelsResponse.nodes.find(
      (label) => label.name.toLowerCase() === labelName.toLowerCase()
    );

    if (!label) {
      console.log(
        `Label "${labelName}" not found on issue ${issue.identifier}`
      );
      return;
    }

    // Remove the label from the issue
    const currentLabels = issue.labelIds || [];
    const updatedLabels = currentLabels.filter((id) => id !== label.id);
    await issue.update({
      labelIds: updatedLabels,
    });

    console.log(`Removed label "${labelName}" from issue ${issue.identifier}`);

    // Notify in the issue comments
    await linearClient.createComment({
      issueId: issue.id,
      body: `I've removed the label **${labelName}**.`,
    });
  } catch (error) {
    console.error(`Error removing label:`, error);
    throw error;
  }
};

/**
 * Assign a Linear issue to a team member
 */
export const assignIssue = async (
  issueId: string,
  assigneeEmail: string
): Promise<void> => {
  try {
    // Fetch the issue
    const issue = await linearClient.issue(issueId);

    // Get the issue's team
    const team = await issue.team;
    if (!team) {
      throw new Error('Could not determine the team for this issue');
    }

    // Get team members
    const teamMembersResponse = await team.members();

    // Find the team member that matches the requested email
    let foundMember: any = null;
    let foundUserName = assigneeEmail;

    // Get all users in the organization
    const usersResponse = await linearClient.users();
    const users = usersResponse.nodes;

    // Find the user by email
    const targetUser = users.find((user) => user.email === assigneeEmail);

    if (targetUser) {
      // Find the team membership for this user
      foundMember = teamMembersResponse.nodes.find(
        (member: any) => member.id === targetUser.id
      );
      foundUserName = targetUser.name || assigneeEmail;
    }

    if (!foundMember) {
      throw new Error(
        `Could not find team member with email "${assigneeEmail}"`
      );
    }

    // Update the issue with the new assignee
    await issue.update({
      assigneeId: foundMember.id,
    });

    console.log(`Assigned issue ${issue.identifier} to ${foundUserName}`);

    // Notify in the issue comments
    await linearClient.createComment({
      issueId: issue.id,
      body: `I've assigned this issue to **${foundUserName}**.`,
    });
  } catch (error) {
    console.error(`Error assigning issue:`, error);
    throw error;
  }
};

/**
 * Create a new Linear issue
 */
export const createIssue = async (
  teamId: string,
  title: string,
  description: string,
  status?: string,
  priority?: number,
  parentIssueId?: string
): Promise<void> => {
  try {
    // Get the team
    const team = await linearClient.team(teamId);

    // Prepare creation parameters
    const createParams: {
      title: string;
      description: string;
      priority?: number;
      parentId?: string;
    } = {
      title,
      description,
    };

    // Add priority if specified
    if (priority !== undefined) {
      createParams.priority = priority;
    }

    // Add parent issue if specified
    if (parentIssueId) {
      createParams.parentId = parentIssueId;
    }

    // Create the issue
    const issueCreateInput = {
      ...createParams,
      teamId: team.id,
    };

    // Use the Linear SDK to create the issue
    const issueResponse = await linearClient.createIssue(issueCreateInput);

    // Check if issue was created successfully
    if (issueResponse && issueResponse.issue) {
      // Get the actual issue object
      const newIssueObj = await issueResponse.issue;
      console.log(`Created new issue ${newIssueObj.identifier}: ${title}`);

      // Update state if specified
      if (status) {
        // Find all workflow states for the team
        const statesResponse = await linearClient.workflowStates({
          filter: { team: { id: { eq: team.id } } },
        });

        // Find the state that matches the requested status name
        const state = statesResponse.nodes.find(
          (state) => state.name.toLowerCase() === status.toLowerCase()
        );

        if (state) {
          await newIssueObj.update({
            stateId: state.id,
          });

          console.log(
            `Set new issue ${newIssueObj.identifier} status to "${status}"`
          );
        }
      }

      // If this was created from another issue, add a comment linking back
      if (parentIssueId) {
        const parentIssue = await linearClient.issue(parentIssueId);

        await linearClient.createComment({
          issueId: parentIssue.id,
          body: `I've created a subtask: ${newIssueObj.identifier} - ${title}`,
        });
      }
    } else {
      console.log(`Failed to create issue "${title}"`);
    }
  } catch (error) {
    console.error(`Error creating issue:`, error);
    throw error;
  }
};

/**
 * Add a URL attachment to a Linear issue
 */
export const addIssueAttachment = async (
  issueId: string,
  url: string,
  title: string
): Promise<void> => {
  try {
    // Fetch the issue to ensure it exists
    const issue = await linearClient.issue(issueId);

    // Create the attachment
    const response = await linearClient.createAttachment({
      issueId: issue.id,
      url,
      title,
    });

    console.log(`Added attachment "${title}" to issue ${issue.identifier}`);

    // Notify in the issue comments
    await linearClient.createComment({
      issueId: issue.id,
      body: `I've attached [${title}](${url}).`,
    });
  } catch (error) {
    console.error(`Error adding attachment:`, error);
    throw error;
  }
};

/**
 * Update the priority of a Linear issue
 */
export const updateIssuePriority = async (
  issueIdOrIdentifier: string,
  priority: number
): Promise<void> => {
  try {
    // Get the issue
    const issue = await linearClient.issue(issueIdOrIdentifier);
    if (!issue) {
      console.error(`Issue ${issueIdOrIdentifier} not found`);
      return;
    }

    // Update the issue with the new priority
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
  issueIdOrIdentifier: string,
  pointEstimate: number
): Promise<void> => {
  try {
    // Get the issue
    const issue = await linearClient.issue(issueIdOrIdentifier);
    if (!issue) {
      console.error(`Issue ${issueIdOrIdentifier} not found`);
      return;
    }

    // Update the issue with the new estimate
    await issue.update({ estimate: pointEstimate });

    console.log(
      `Updated issue ${issueIdOrIdentifier} point estimate to ${pointEstimate}`
    );

    // Add a comment to indicate the change
    await linearClient.createComment({
      issueId: issue.id,
      body: `I've updated the point estimate to ${pointEstimate} points.`,
    });
  } catch (error: unknown) {
    console.error(
      `Error setting point estimate for issue ${issueIdOrIdentifier}:`,
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
};
