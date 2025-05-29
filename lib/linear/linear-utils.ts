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

/**
 * Get all teams in the workspace
 */
export const getTeams = async (linearClient: LinearClient): Promise<string> => {
  try {
    const teams = await linearClient.teams();

    if (teams.nodes.length === 0) {
      return 'No teams found in the workspace.';
    }

    let result = `Found ${teams.nodes.length} teams:\n\n`;

    for (const team of teams.nodes) {
      result += `**${team.name}** (${team.key})\n`;
      if (team.description) {
        result += `  Description: ${team.description}\n`;
      }

      // Get team members count
      const members = await team.members();
      result += `  Members: ${members.nodes.length}\n`;

      // Get active issues count
      const issues = await linearClient.issues({
        filter: {
          team: { id: { eq: team.id } },
          state: { type: { neq: 'completed' } },
        },
        first: 1,
      });
      result += `  Active Issues: ${issues.nodes.length}\n\n`;
    }

    return result;
  } catch (error: unknown) {
    console.error(
      'Error getting teams:',
      error instanceof Error ? error.message : String(error)
    );
    return 'Error retrieving teams from Linear.';
  }
};

/**
 * Get all projects in the workspace
 */
export const getProjects = async (
  linearClient: LinearClient
): Promise<string> => {
  try {
    const projects = await linearClient.projects();

    if (projects.nodes.length === 0) {
      return 'No projects found in the workspace.';
    }

    let result = `Found ${projects.nodes.length} projects:\n\n`;

    for (const project of projects.nodes) {
      result += `**${project.name}**\n`;
      if (project.description) {
        result += `  Description: ${project.description}\n`;
      }

      // Get project status
      const state = await project.state;
      if (state && typeof state === 'object' && 'name' in state) {
        result += `  Status: ${(state as any).name}\n`;
      } else {
        result += `  Status: Unknown\n`;
      }

      // Get progress
      result += `  Progress: ${project.progress}%\n`;

      // Get target date if available
      if (project.targetDate) {
        result += `  Target Date: ${new Date(
          project.targetDate
        ).toLocaleDateString()}\n`;
      }

      // Get team info
      const teams = await project.teams();
      if (teams.nodes.length > 0) {
        const teamNames = teams.nodes.map((t) => t.name).join(', ');
        result += `  Teams: ${teamNames}\n`;
      }

      result += '\n';
    }

    return result;
  } catch (error: unknown) {
    console.error(
      'Error getting projects:',
      error instanceof Error ? error.message : String(error)
    );
    return 'Error retrieving projects from Linear.';
  }
};

/**
 * Get all initiatives in the workspace
 */
export const getInitiatives = async (
  linearClient: LinearClient
): Promise<string> => {
  try {
    const initiatives = await linearClient.initiatives();

    if (initiatives.nodes.length === 0) {
      return 'No initiatives found in the workspace.';
    }

    let result = `Found ${initiatives.nodes.length} initiatives:\n\n`;

    for (const initiative of initiatives.nodes) {
      result += `**${initiative.name}**\n`;
      if (initiative.description) {
        result += `  Description: ${initiative.description}\n`;
      }

      // Get target date if available
      if (initiative.targetDate) {
        result += `  Target Date: ${new Date(
          initiative.targetDate
        ).toLocaleDateString()}\n`;
      }

      // Get projects in this initiative
      const projects = await initiative.projects();
      if (projects.nodes.length > 0) {
        result += `  Projects (${projects.nodes.length}):\n`;
        for (const project of projects.nodes) {
          result += `    - ${project.name} (${project.progress}%)\n`;
        }
      }

      result += '\n';
    }

    return result;
  } catch (error: unknown) {
    console.error(
      'Error getting initiatives:',
      error instanceof Error ? error.message : String(error)
    );
    return 'Error retrieving initiatives from Linear.';
  }
};

/**
 * Get workspace users
 */
export const getUsers = async (linearClient: LinearClient): Promise<string> => {
  try {
    const users = await linearClient.users();

    if (users.nodes.length === 0) {
      return 'No users found in the workspace.';
    }

    let result = `Found ${users.nodes.length} users:\n\n`;

    for (const user of users.nodes) {
      result += `**${user.name}**\n`;
      result += `  Email: ${user.email}\n`;
      if (user.displayName && user.displayName !== user.name) {
        result += `  Display Name: ${user.displayName}\n`;
      }
      result += `  Active: ${user.active ? 'Yes' : 'No'}\n`;
      result += `  Admin: ${user.admin ? 'Yes' : 'No'}\n\n`;
    }

    return result;
  } catch (error: unknown) {
    console.error(
      'Error getting users:',
      error instanceof Error ? error.message : String(error)
    );
    return 'Error retrieving users from Linear.';
  }
};

/**
 * Get recent issues across the workspace
 */
export const getRecentIssues = async (
  linearClient: LinearClient,
  limit: number = 20,
  teamId?: string
): Promise<string> => {
  try {
    const filter: any = {};

    if (teamId) {
      filter.team = { id: { eq: teamId } };
    }

    const issues = await linearClient.issues({
      filter,
      first: limit,
    });

    if (issues.nodes.length === 0) {
      return teamId
        ? `No recent issues found for the specified team.`
        : 'No recent issues found in the workspace.';
    }

    let result = `Found ${issues.nodes.length} recent issues${
      teamId ? ' for the specified team' : ''
    }:\n\n`;

    for (const issue of issues.nodes) {
      result += `**${issue.identifier}: ${issue.title}**\n`;

      // Get state
      const state = await issue.state;
      result += `  Status: ${state?.name || 'Unknown'}\n`;

      // Get assignee
      const assignee = await issue.assignee;
      result += `  Assignee: ${assignee?.name || 'Unassigned'}\n`;

      // Get team
      const team = await issue.team;
      result += `  Team: ${team?.name || 'Unknown'}\n`;

      // Get priority
      if (issue.priority) {
        const priorityNames = [
          'No Priority',
          'Low',
          'Medium',
          'High',
          'Urgent',
        ];
        result += `  Priority: ${priorityNames[issue.priority] || 'Unknown'}\n`;
      }

      // Get labels
      const labels = await issue.labels();
      if (labels.nodes.length > 0) {
        const labelNames = labels.nodes.map((l: any) => l.name).join(', ');
        result += `  Labels: ${labelNames}\n`;
      }

      // Get brief description
      if (issue.description) {
        const briefDesc =
          issue.description.length > 100
            ? `${issue.description.substring(0, 100)}...`
            : issue.description;
        result += `  Description: ${briefDesc}\n`;
      }

      result += `  Updated: ${new Date(
        issue.updatedAt
      ).toLocaleDateString()}\n\n`;
    }

    return result;
  } catch (error: unknown) {
    console.error(
      'Error getting recent issues:',
      error instanceof Error ? error.message : String(error)
    );
    return 'Error retrieving recent issues from Linear.';
  }
};

/**
 * Search for issues by text query
 */
export const searchIssues = async (
  linearClient: LinearClient,
  query: string,
  limit: number = 10
): Promise<string> => {
  try {
    const issues = await linearClient.issues({
      filter: {
        or: [
          { title: { containsIgnoreCase: query } },
          { description: { containsIgnoreCase: query } },
        ],
      },
      first: limit,
    });

    if (issues.nodes.length === 0) {
      return `No issues found matching "${query}".`;
    }

    let result = `Found ${issues.nodes.length} issues matching "${query}":\n\n`;

    for (const issue of issues.nodes) {
      result += `**${issue.identifier}: ${issue.title}**\n`;

      // Get state
      const state = await issue.state;
      result += `  Status: ${state?.name || 'Unknown'}\n`;

      // Get assignee
      const assignee = await issue.assignee;
      result += `  Assignee: ${assignee?.name || 'Unassigned'}\n`;

      // Get team
      const team = await issue.team;
      result += `  Team: ${team?.name || 'Unknown'}\n`;

      // Get brief description with highlighted query
      if (issue.description) {
        const briefDesc =
          issue.description.length > 150
            ? `${issue.description.substring(0, 150)}...`
            : issue.description;
        result += `  Description: ${briefDesc}\n`;
      }

      result += '\n';
    }

    return result;
  } catch (error: unknown) {
    console.error(
      'Error searching issues:',
      error instanceof Error ? error.message : String(error)
    );
    return `Error searching for issues matching "${query}".`;
  }
};

/**
 * Get workflow states for a team
 */
export const getWorkflowStates = async (
  linearClient: LinearClient,
  teamId?: string
): Promise<string> => {
  try {
    const filter: any = {};
    if (teamId) {
      filter.team = { id: { eq: teamId } };
    }

    const states = await linearClient.workflowStates({ filter });

    if (states.nodes.length === 0) {
      return teamId
        ? 'No workflow states found for the specified team.'
        : 'No workflow states found.';
    }

    let result = `Found ${states.nodes.length} workflow states${
      teamId ? ' for the specified team' : ''
    }:\n\n`;

    // Group by team
    const statesByTeam: { [key: string]: any[] } = {};

    for (const state of states.nodes) {
      const team = await state.team;
      const teamName = team?.name || 'Unknown Team';

      if (!statesByTeam[teamName]) {
        statesByTeam[teamName] = [];
      }
      statesByTeam[teamName].push(state);
    }

    for (const [teamName, teamStates] of Object.entries(statesByTeam)) {
      result += `**${teamName}:**\n`;
      for (const state of teamStates) {
        result += `  - ${state.name} (${state.type})\n`;
        if (state.description) {
          result += `    Description: ${state.description}\n`;
        }
      }
      result += '\n';
    }

    return result;
  } catch (error: unknown) {
    console.error(
      'Error getting workflow states:',
      error instanceof Error ? error.message : String(error)
    );
    return 'Error retrieving workflow states from Linear.';
  }
};
