import type { LinearClient } from "@linear/sdk";
import {
  agentActivity,
  logToLinearIssue,
} from "./linear-agent-session-manager.js";

/**
 * Get the context for an issue including comments, child issues, and parent issue
 */
export const getIssueContext = async (
  linearClient: LinearClient,
  issueIdOrIdentifier: string,
  commentId?: string,
): Promise<string> => {
  const issue = await linearClient.issue(issueIdOrIdentifier);
  if (!issue) {
    return `ERROR: Issue ${issueIdOrIdentifier} not found. Please check the issue ID or identifier and try again.`;
  }

  // Log that we're analyzing the issue
  await agentActivity.thought(
    issueIdOrIdentifier,
    `📋 Analyzing issue context for ${issue.identifier} - ${issue.title}`,
  );

  // Mark this as the assigned issue
  let context = ">>>>> ASSIGNED/TAGGED ISSUE <<<<<\n";
  context += `ISSUE ${issue.identifier}: ${issue.title}\n`;
  context += `DESCRIPTION: ${
    issue.description || "No description provided"
  }\n\n`;

  // Add ALL comments for comprehensive context
  const comments = await issue.comments({ first: 50 }); // Increased from 10 to 50 for better context
  if (comments.nodes.length > 0) {
    context += "ALL COMMENTS:\n";

    for (const comment of comments.nodes) {
      // If this is the triggering comment, highlight it
      const isTriggering = commentId && comment.id === commentId;
      const prefix = isTriggering ? "► " : "";

      // Add user info if available
      let userName = "Unknown";
      if (comment.user) {
        try {
          const user = await comment.user;
          userName = user ? user.name || "Unknown" : "Unknown";
        } catch (e) {
          console.error("Error getting user name:", e);
        }
      }

      context += `${prefix}${userName}: ${comment.body}\n\n`;
    }
  }

  // Add labels if any
  const labels = await issue.labels();
  if (labels.nodes.length > 0) {
    const labelNames = labels.nodes.map((l: any) => l.name).join(", ");
    context += `LABELS: ${labelNames}\n`;
  }

  // Get parent issue if this is a child issue
  try {
    const parent = await issue.parent;
    if (parent) {
      context += "\n----- PARENT ISSUE (Context Only) -----\n";
      context += `ISSUE ${parent.identifier}: ${parent.title}\n`;
      context += `DESCRIPTION: ${
        parent.description || "No description provided"
      }\n`;

      // Add parent issue labels
      const parentLabels = await parent.labels();
      if (parentLabels.nodes.length > 0) {
        const labelNames = parentLabels.nodes
          .map((l: any) => l.name)
          .join(", ");
        context += `LABELS: ${labelNames}\n`;
      }
    }
  } catch (error) {
    console.error("Error getting parent issue:", error);
  }

  // Get child issues if any
  try {
    const children = await issue.children();
    if (children.nodes.length > 0) {
      context += "\n----- CHILD ISSUES (Context Only) -----\n";

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

        context += "\n";
      }
    }
  } catch (error) {
    console.error("Error getting child issues:", error);
  }

  return context;
};

/**
 * Update the status of a Linear issue
 */
export const updateIssueStatus = async (
  linearClient: LinearClient,
  issueIdOrIdentifier: string,
  statusName: string,
): Promise<void> => {
  try {
    // Log the status update attempt
    await agentActivity.action(
      issueIdOrIdentifier,
      "Updating issue status",
      `Changing to: ${statusName}`,
    );

    // Get all workflow states for the issue's team
    const issue = await linearClient.issue(issueIdOrIdentifier);
    if (!issue) {
      console.error(`Issue ${issueIdOrIdentifier} not found`);
      await agentActivity.error(
        issueIdOrIdentifier,
        "Failed to update status: Issue not found",
      );
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
      (s: any) => s.name.toLowerCase() === statusName.toLowerCase(),
    );

    if (!state) {
      console.error(
        `Status "${statusName}" not found for team ${
          team.name
        }. Available states: ${states.nodes.map((s: any) => s.name).join(", ")}`,
      );
      return;
    }

    // Update the issue with the new state
    await issue.update({ stateId: state.id });

    console.log(`Updated issue ${issueIdOrIdentifier} status to ${statusName}`);
    await agentActivity.action(
      issueIdOrIdentifier,
      "Updated issue status",
      `Changed to: ${statusName}`,
      `Successfully changed to ${state.name}`,
    );
  } catch (error: unknown) {
    console.error(
      `Error updating status for issue ${issueIdOrIdentifier}:`,
      error instanceof Error ? error.message : String(error),
    );
    await agentActivity.error(
      issueIdOrIdentifier,
      `Failed to update status to ${statusName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

/**
 * Add a label to a Linear issue
 */
export const addLabel = async (
  linearClient: LinearClient,
  issueIdOrIdentifier: string,
  labelName: string,
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
    await linearClient.issueAddLabel(issueIdOrIdentifier, label.id);
    console.log(`Added label "${labelName}" to issue ${issueIdOrIdentifier}`);
  } catch (error: unknown) {
    console.error(
      `Error adding label "${labelName}" to issue ${issueIdOrIdentifier}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
};

/**
 * Remove a label from a Linear issue
 */
export const removeLabel = async (
  linearClient: LinearClient,
  issueIdOrIdentifier: string,
  labelName: string,
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
    await linearClient.issueRemoveLabel(issueIdOrIdentifier, label.id);
    console.log(
      `Removed label "${labelName}" from issue ${issueIdOrIdentifier}`,
    );
  } catch (error: unknown) {
    console.error(
      `Error removing label "${labelName}" from issue ${issueIdOrIdentifier}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
};

/**
 * Assign a Linear issue to a team member
 */
export const assignIssue = async (
  linearClient: LinearClient,
  issueIdOrIdentifier: string,
  assigneeEmail: string,
): Promise<void> => {
  try {
    // Find the user by email
    const usersResponse = await linearClient.users();
    const user = usersResponse.nodes.find(
      (user: any) => user.email === assigneeEmail,
    );

    if (!user) {
      console.error(`User with email "${assigneeEmail}" not found`);
      return;
    }

    // Assign the issue to the user
    const issue = await linearClient.issue(issueIdOrIdentifier);
    await issue.update({ assigneeId: user.id });
    console.log(`Assigned issue ${issueIdOrIdentifier} to ${assigneeEmail}`);
  } catch (error: unknown) {
    console.error(
      `Error assigning issue ${issueIdOrIdentifier} to ${assigneeEmail}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
};

/**
 * Create a new Linear issue
 */
export const createIssue = async (
  linearClient: LinearClient,
  teamIdOrKeyOrName: string,
  title: string,
  description: string,
  status?: string,
  priority?: number,
  parentIssueId?: string,
  projectId?: string,
): Promise<{
  success: boolean;
  message: string;
  issueId?: string;
  error?: string;
}> => {
  try {
    // First, resolve the team ID if a key or name was provided
    let teamId = teamIdOrKeyOrName;

    // Check if the provided value is already a UUID (contains hyphens and is 36 chars)
    const isUUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        teamIdOrKeyOrName,
      );

    if (!isUUID) {
      // It's likely a team key or name, so we need to find the team
      const teams = await linearClient.teams();
      const team = teams.nodes.find(
        (t: any) =>
          t.key.toLowerCase() === teamIdOrKeyOrName.toLowerCase() ||
          t.name.toLowerCase() === teamIdOrKeyOrName.toLowerCase(),
      );

      if (!team) {
        const availableTeams = teams.nodes
          .map((t: any) => `${t.name} (${t.key})`)
          .join(", ");
        return {
          success: false,
          error: `Team "${teamIdOrKeyOrName}" not found. Available teams: ${availableTeams}`,
          message: `Failed to create issue: Team "${teamIdOrKeyOrName}" not found`,
        };
      }

      teamId = team.id;
      console.log(`Resolved team "${teamIdOrKeyOrName}" to ID: ${teamId}`);
    }

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
        (state: any) => state.name.toLowerCase() === status.toLowerCase(),
      );

      if (state) {
        stateId = state.id;
      } else {
        const availableStates = states.nodes.map((s: any) => s.name).join(", ");
        return {
          success: false,
          error: `Status "${status}" not found for this team. Available statuses: ${availableStates}`,
          message: `Failed to create issue: Invalid status "${status}"`,
        };
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

    if (projectId) {
      issuePayload.projectId = projectId;
    }

    const newIssue = await linearClient.createIssue(issuePayload);
    const createdIssue = await newIssue.issue;

    if (createdIssue) {
      console.log(`Created issue: ${createdIssue.identifier}`);
      return {
        success: true,
        message: `Successfully created issue: ${createdIssue.identifier} - ${title}`,
        issueId: createdIssue.id,
      };
    }
    return {
      success: false,
      error: "Issue creation returned no issue object",
      message: "Failed to create issue: Unknown error occurred",
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error creating issue:", errorMessage);
    return {
      success: false,
      error: errorMessage,
      message: `Failed to create issue: ${errorMessage}`,
    };
  }
};

/**
 * Add a URL attachment to a Linear issue
 */
export const addIssueAttachment = async (
  linearClient: LinearClient,
  issueIdOrIdentifier: string,
  url: string,
  title: string,
): Promise<void> => {
  try {
    // Get the issue to ensure we have the UUID for the attachment API
    const issue = await linearClient.issue(issueIdOrIdentifier);
    if (!issue) {
      console.error(`Issue ${issueIdOrIdentifier} not found`);
      return;
    }

    await linearClient.createAttachment({
      issueId: issue.id, // Use the UUID for the attachment API
      url,
      title,
    });
    console.log(`Added attachment "${title}" to issue ${issueIdOrIdentifier}`);
  } catch (error: unknown) {
    console.error(
      `Error adding attachment to issue ${issueIdOrIdentifier}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
};

/**
 * Update the priority of a Linear issue
 */
export const updateIssuePriority = async (
  linearClient: LinearClient,
  issueIdOrIdentifier: string,
  priority: number,
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
      error instanceof Error ? error.message : String(error),
    );
  }
};

/**
 * Set the point estimate for a Linear issue
 */
export const setPointEstimate = async (
  linearClient: LinearClient,
  issueIdOrIdentifier: string,
  pointEstimate: number,
): Promise<void> => {
  try {
    const issue = await linearClient.issue(issueIdOrIdentifier);
    if (!issue) {
      console.error(`Issue ${issueIdOrIdentifier} not found`);
      return;
    }

    await issue.update({ estimate: pointEstimate });
    console.log(
      `Set point estimate for issue ${issueIdOrIdentifier} to ${pointEstimate}`,
    );
  } catch (error: unknown) {
    console.error(
      `Error setting point estimate for issue ${issueIdOrIdentifier}:`,
      error instanceof Error ? error.message : String(error),
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
      return "No teams found in the workspace.";
    }

    let result = `Found ${teams.nodes.length} teams:\n\n`;

    for (const team of teams.nodes) {
      result += `**${team.name}** (${team.key})\n`;
      result += `  ID: ${team.id}\n`;
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
          state: { type: { neq: "completed" } },
        },
        first: 1,
      });
      result += `  Active Issues: ${issues.nodes.length}\n\n`;
    }

    return result;
  } catch (error: unknown) {
    console.error(
      "Error getting teams:",
      error instanceof Error ? error.message : String(error),
    );
    return "Error retrieving teams from Linear.";
  }
};

/**
 * Get all projects in the workspace
 */
export const getProjects = async (
  linearClient: LinearClient,
): Promise<string> => {
  try {
    const projects = await linearClient.projects();

    if (projects.nodes.length === 0) {
      return "No projects found in the workspace.";
    }

    let result = `Found ${projects.nodes.length} projects:\n\n`;

    for (const project of projects.nodes) {
      result += `**${project.name}**\n`;
      result += `  ID: ${project.id}\n`;
      if (project.description) {
        result += `  Description: ${project.description}\n`;
      }

      // Get project status
      const state = await project.state;
      if (state && typeof state === "object" && "name" in state) {
        result += `  Status: ${(state as any).name}\n`;
      } else {
        result += "  Status: Unknown\n";
      }

      // Get progress
      result += `  Progress: ${project.progress}%\n`;

      // Get target date if available
      if (project.targetDate) {
        result += `  Target Date: ${new Date(
          project.targetDate,
        ).toLocaleDateString()}\n`;
      }

      // Get team info
      const teams = await project.teams();
      if (teams.nodes.length > 0) {
        const teamNames = teams.nodes.map((t) => t.name).join(", ");
        result += `  Teams: ${teamNames}\n`;
      }

      result += "\n";
    }

    return result;
  } catch (error: unknown) {
    console.error(
      "Error getting projects:",
      error instanceof Error ? error.message : String(error),
    );
    return "Error retrieving projects from Linear.";
  }
};

/**
 * Get all initiatives in the workspace
 */
export const getInitiatives = async (
  linearClient: LinearClient,
): Promise<string> => {
  try {
    const initiatives = await linearClient.initiatives();

    if (initiatives.nodes.length === 0) {
      return "No initiatives found in the workspace.";
    }

    let result = `Found ${initiatives.nodes.length} initiatives:\n\n`;

    for (const initiative of initiatives.nodes) {
      result += `**${initiative.name}**\n`;
      result += `  ID: ${initiative.id}\n`;
      if (initiative.description) {
        result += `  Description: ${initiative.description}\n`;
      }

      // Get target date if available
      if (initiative.targetDate) {
        result += `  Target Date: ${new Date(
          initiative.targetDate,
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

      result += "\n";
    }

    return result;
  } catch (error: unknown) {
    console.error(
      "Error getting initiatives:",
      error instanceof Error ? error.message : String(error),
    );
    return "Error retrieving initiatives from Linear.";
  }
};

/**
 * Get workspace users
 */
export const getUsers = async (linearClient: LinearClient): Promise<string> => {
  try {
    const users = await linearClient.users();

    if (users.nodes.length === 0) {
      return "No users found in the workspace.";
    }

    let result = `Found ${users.nodes.length} users:\n\n`;

    for (const user of users.nodes) {
      result += `**${user.name}**\n`;
      result += `  ID: ${user.id}\n`;
      result += `  Email: ${user.email}\n`;
      if (user.displayName && user.displayName !== user.name) {
        result += `  Display Name: ${user.displayName}\n`;
      }
      result += `  Active: ${user.active ? "Yes" : "No"}\n`;
      result += `  Admin: ${user.admin ? "Yes" : "No"}\n\n`;
    }

    return result;
  } catch (error: unknown) {
    console.error(
      "Error getting users:",
      error instanceof Error ? error.message : String(error),
    );
    return "Error retrieving users from Linear.";
  }
};

/**
 * Get recent issues across the workspace
 */
export const getRecentIssues = async (
  linearClient: LinearClient,
  limit = 20,
  teamId?: string,
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
        ? "No recent issues found for the specified team."
        : "No recent issues found in the workspace.";
    }

    let result = `Found ${issues.nodes.length} recent issues${
      teamId ? " for the specified team" : ""
    }:\n\n`;

    for (const issue of issues.nodes) {
      result += `**${issue.identifier}: ${issue.title}**\n`;

      // Get state
      const state = await issue.state;
      result += `  Status: ${state?.name || "Unknown"}\n`;

      // Get assignee
      const assignee = await issue.assignee;
      result += `  Assignee: ${assignee?.name || "Unassigned"}\n`;

      // Get team
      const team = await issue.team;
      result += `  Team: ${team?.name || "Unknown"}\n`;

      // Get priority
      if (issue.priority) {
        const priorityNames = [
          "No Priority",
          "Low",
          "Medium",
          "High",
          "Urgent",
        ];
        result += `  Priority: ${priorityNames[issue.priority] || "Unknown"}\n`;
      }

      // Get labels
      const labels = await issue.labels();
      if (labels.nodes.length > 0) {
        const labelNames = labels.nodes.map((l: any) => l.name).join(", ");
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
        issue.updatedAt,
      ).toLocaleDateString()}\n\n`;
    }

    return result;
  } catch (error: unknown) {
    console.error(
      "Error getting recent issues:",
      error instanceof Error ? error.message : String(error),
    );
    return "Error retrieving recent issues from Linear.";
  }
};

/**
 * Search for issues by text query
 */
export const searchIssues = async (
  linearClient: LinearClient,
  query: string,
  limit = 10,
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
      result += `  Status: ${state?.name || "Unknown"}\n`;

      // Get assignee
      const assignee = await issue.assignee;
      result += `  Assignee: ${assignee?.name || "Unassigned"}\n`;

      // Get team
      const team = await issue.team;
      result += `  Team: ${team?.name || "Unknown"}\n`;

      // Get brief description with highlighted query
      if (issue.description) {
        const briefDesc =
          issue.description.length > 150
            ? `${issue.description.substring(0, 150)}...`
            : issue.description;
        result += `  Description: ${briefDesc}\n`;
      }

      result += "\n";
    }

    return result;
  } catch (error: unknown) {
    console.error(
      "Error searching issues:",
      error instanceof Error ? error.message : String(error),
    );
    return `Error searching for issues matching "${query}".`;
  }
};

/**
 * Get workflow states for a team
 */
export const getWorkflowStates = async (
  linearClient: LinearClient,
  teamId?: string,
): Promise<string> => {
  try {
    const filter: any = {};
    if (teamId) {
      filter.team = { id: { eq: teamId } };
    }

    const states = await linearClient.workflowStates({ filter });

    if (states.nodes.length === 0) {
      return teamId
        ? "No workflow states found for the specified team."
        : "No workflow states found.";
    }

    let result = `Found ${states.nodes.length} workflow states${
      teamId ? " for the specified team" : ""
    }:\n\n`;

    // Group by team
    const statesByTeam: { [key: string]: any[] } = {};

    for (const state of states.nodes) {
      const team = await state.team;
      const teamName = team?.name || "Unknown Team";

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
      result += "\n";
    }

    return result;
  } catch (error: unknown) {
    console.error(
      "Error getting workflow states:",
      error instanceof Error ? error.message : String(error),
    );
    return "Error retrieving workflow states from Linear.";
  }
};

/**
 * Create a comment on a Linear issue
 */
export const createComment = async (
  linearClient: LinearClient,
  issueIdOrIdentifier: string,
  body: string,
): Promise<void> => {
  try {
    // Log the comment creation attempt
    await agentActivity.action(
      issueIdOrIdentifier,
      "Creating comment",
      `${body.length} characters`,
    );

    const issue = await linearClient.issue(issueIdOrIdentifier);
    if (!issue) {
      console.error(`Issue ${issueIdOrIdentifier} not found`);
      await agentActivity.thought(
        issueIdOrIdentifier,
        "❌ Comment creation failed: Issue not found",
      );
      return;
    }

    await linearClient.createComment({
      issueId: issue.id,
      body,
    });
    console.log(`Created comment on issue ${issueIdOrIdentifier}`);
    await agentActivity.action(
      issueIdOrIdentifier,
      "Created comment",
      `${body.length} characters`,
      `Comment: ${body.substring(0, 100)}${body.length > 100 ? "..." : ""}`,
    );
  } catch (error: unknown) {
    console.error(
      `Error creating comment on issue ${issueIdOrIdentifier}:`,
      error instanceof Error ? error.message : String(error),
    );
    await agentActivity.thought(
      issueIdOrIdentifier,
      `❌ Comment creation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

/**
 * Set an issue as a child of another issue (parent-child relationship)
 */
export const setIssueParent = async (
  linearClient: LinearClient,
  issueIdOrIdentifier: string,
  parentIssueIdOrIdentifier: string,
): Promise<{
  success: boolean;
  message: string;
  error?: string;
}> => {
  try {
    // Validate both issues exist
    const issue = await linearClient.issue(issueIdOrIdentifier);
    if (!issue) {
      return {
        success: false,
        error: `Child issue ${issueIdOrIdentifier} not found`,
        message: "Failed to set parent: Child issue not found",
      };
    }

    const parentIssue = await linearClient.issue(parentIssueIdOrIdentifier);
    if (!parentIssue) {
      return {
        success: false,
        error: `Parent issue ${parentIssueIdOrIdentifier} not found`,
        message: "Failed to set parent: Parent issue not found",
      };
    }

    // Log the relationship creation
    await agentActivity.action(
      issueIdOrIdentifier,
      "Setting issue parent",
      `Making ${issue.identifier} a child of ${parentIssue.identifier}`,
    );

    // Update the issue with the parent relationship
    await issue.update({ parentId: parentIssue.id });

    const successMessage = `Successfully made ${issue.identifier} a child of ${parentIssue.identifier}`;
    console.log(successMessage);

    await agentActivity.action(
      issueIdOrIdentifier,
      "Parent relationship created",
      successMessage,
    );

    return {
      success: true,
      message: successMessage,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `Error setting parent for issue ${issueIdOrIdentifier}:`,
      errorMessage,
    );

    await agentActivity.error(
      issueIdOrIdentifier,
      `Failed to set parent: ${errorMessage}`,
    );

    return {
      success: false,
      error: errorMessage,
      message: `Failed to set parent relationship: ${errorMessage}`,
    };
  }
};

/**
 * Add an issue to a project
 */
export const addIssueToProject = async (
  linearClient: LinearClient,
  issueIdOrIdentifier: string,
  projectId: string,
): Promise<{
  success: boolean;
  message: string;
  error?: string;
}> => {
  try {
    // Validate issue exists
    const issue = await linearClient.issue(issueIdOrIdentifier);
    if (!issue) {
      return {
        success: false,
        error: `Issue ${issueIdOrIdentifier} not found`,
        message: "Failed to add to project: Issue not found",
      };
    }

    // Validate project exists
    const project = await linearClient.project(projectId);
    if (!project) {
      return {
        success: false,
        error: `Project ${projectId} not found`,
        message: "Failed to add to project: Project not found",
      };
    }

    // Log the project assignment
    await agentActivity.action(
      issueIdOrIdentifier,
      "Adding issue to project",
      `Adding ${issue.identifier} to project ${project.name}`,
    );

    // Update the issue with the project assignment
    await issue.update({ projectId: projectId });

    const successMessage = `Successfully added ${issue.identifier} to project ${project.name}`;
    console.log(successMessage);

    await agentActivity.action(
      issueIdOrIdentifier,
      "Added to project",
      successMessage,
    );

    return {
      success: true,
      message: successMessage,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `Error adding issue ${issueIdOrIdentifier} to project:`,
      errorMessage,
    );

    await agentActivity.error(
      issueIdOrIdentifier,
      `Failed to add to project: ${errorMessage}`,
    );

    return {
      success: false,
      error: errorMessage,
      message: `Failed to add to project: ${errorMessage}`,
    };
  }
};
