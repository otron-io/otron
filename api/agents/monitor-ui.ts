import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { env } from '../../src/env.js';

// Initialize Redis client for monitoring
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

/**
 * API endpoint to serve a UI for monitoring agent activity
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Get recent agent activities from memory system
    const agentDelegations = await redis.zrange(
      'memory:agent_delegations',
      0,
      9,
      {
        rev: true,
        withScores: true,
      }
    );

    // Get recent tool usages by agent type
    const devToolUsage = await redis.zrange('memory:tool_usage:dev', 0, 9, {
      rev: true,
      withScores: true,
    });

    const linearToolUsage = await redis.zrange(
      'memory:tool_usage:linear',
      0,
      9,
      {
        rev: true,
        withScores: true,
      }
    );

    // Get active issues being processed
    const activeIssues = await redis.zrange('memory:active_issues', 0, 9, {
      rev: true,
      withScores: true,
    });

    // Get recent comments posted by the main agent
    const recentCommentsData = [];

    // For each active issue, try to get recent comments
    for (const issueData of activeIssues.slice(0, 3)) {
      // Limit to first 3 issues for performance
      if (Array.isArray(issueData) && issueData.length >= 1) {
        const issueId = issueData[0];
        const actions = await redis.lrange(
          `memory:issue:${issueId}:action`,
          0,
          5
        );

        for (const actionStr of actions) {
          try {
            const action = JSON.parse(actionStr);
            if (action.data?.type === 'comment') {
              recentCommentsData.push({
                issueId,
                timestamp: action.timestamp,
                content: action.data.content,
              });
            }
          } catch (e) {
            console.error('Error parsing action:', e);
          }
        }
      }
    }

    // Sort comments by timestamp (newest first)
    const recentComments = recentCommentsData
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5); // Show only the 5 most recent comments

    // Generate HTML for the monitor page
    const html = generateHtml(
      agentDelegations,
      devToolUsage,
      linearToolUsage,
      activeIssues,
      recentComments
    );

    // Set content type to HTML
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  } catch (error) {
    console.error('Error in agent monitor UI endpoint:', error);
    res
      .status(500)
      .send(`<html><body><h1>Error</h1><p>${error}</p></body></html>`);
  }
}

/**
 * Generate HTML for the monitoring page
 */
function generateHtml(
  agentDelegations: any[],
  devToolUsage: any[],
  linearToolUsage: any[],
  activeIssues: any[],
  recentComments: any[]
): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Otron Agent Monitor</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      line-height: 1.6;
      margin: 0;
      padding: 20px;
      color: #333;
      background-color: #f5f5f5;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    h1 {
      text-align: center;
      margin: 20px 0 40px;
      color: #2c3e50;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(500px, 1fr));
      grid-gap: 20px;
    }
    .card {
      background: white;
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    h2 {
      margin-top: 0;
      color: #3498db;
      border-bottom: 1px solid #eee;
      padding-bottom: 10px;
    }
    ul {
      list-style: none;
      padding: 0;
    }
    li {
      padding: 10px;
      border-bottom: 1px solid #eee;
    }
    li:last-child {
      border-bottom: none;
    }
    .timestamp {
      color: #7f8c8d;
      font-size: 0.85em;
    }
    .tool-name {
      font-weight: bold;
      color: #2c3e50;
    }
    .tool-count {
      background: #3498db;
      color: white;
      padding: 2px 8px;
      border-radius: 10px;
      float: right;
    }
    .refresh-button {
      display: block;
      margin: 20px auto;
      padding: 10px 20px;
      background: #3498db;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 16px;
    }
    .refresh-button:hover {
      background: #2980b9;
    }
    .agent-tag {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      margin-left: 5px;
    }
    .dev-agent {
      background-color: #2ecc71;
      color: white;
    }
    .linear-agent {
      background-color: #9b59b6;
      color: white;
    }
    .task {
      margin-top: 5px;
      font-style: italic;
    }
    .empty {
      color: #95a5a6;
      font-style: italic;
    }
    .comment-content {
      margin-top: 5px;
      padding: 10px;
      background-color: #f8f9fa;
      border-left: 3px solid #3498db;
      border-radius: 3px;
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Otron Agent Monitor</h1>
    
    <button class="refresh-button" onclick="window.location.reload()">Refresh Data</button>
    
    <div class="grid">
      <div class="card">
        <h2>Recent Agent Delegations</h2>
        <ul>
          ${renderDelegations(agentDelegations)}
        </ul>
      </div>
      
      <div class="card">
        <h2>Recent Comments</h2>
        <ul>
          ${renderComments(recentComments)}
        </ul>
      </div>
      
      <div class="card">
        <h2>Dev Agent Tool Usage</h2>
        <ul>
          ${renderToolUsage(devToolUsage)}
        </ul>
      </div>
      
      <div class="card">
        <h2>Linear Agent Tool Usage</h2>
        <ul>
          ${renderToolUsage(linearToolUsage)}
        </ul>
      </div>
      
      <div class="card">
        <h2>Active Issues</h2>
        <ul>
          ${renderActiveIssues(activeIssues)}
        </ul>
      </div>
    </div>
  </div>
  
  <script>
    // Auto-refresh the page every 15 seconds
    setTimeout(() => {
      window.location.reload();
    }, 15000);
  </script>
</body>
</html>
  `;
}

/**
 * Render delegations as HTML
 */
function renderDelegations(delegations: any[]): string {
  if (!delegations || delegations.length === 0) {
    return `<li class="empty">No recent delegations</li>`;
  }

  return delegations
    .map(([delegationStr, timestamp]) => {
      try {
        const delegation = JSON.parse(delegationStr);
        return `
        <li>
          <div class="timestamp">${new Date(timestamp).toLocaleString()}</div>
          <div>Issue: ${delegation.issueId}</div>
          <div>
            Delegated to: 
            <span class="agent-tag ${
              delegation.targetAgentType === 'dev'
                ? 'dev-agent'
                : 'linear-agent'
            }">
              ${delegation.targetAgentType}
            </span>
          </div>
          <div class="task">${delegation.taskDescription}</div>
        </li>
      `;
      } catch (e) {
        return `<li>Error parsing delegation data</li>`;
      }
    })
    .join('');
}

/**
 * Render tool usage as HTML
 */
function renderToolUsage(toolUsage: any[]): string {
  if (!toolUsage || toolUsage.length === 0) {
    return `<li class="empty">No tool usage data</li>`;
  }

  return toolUsage
    .map(([tool, count]) => {
      return `
      <li>
        <span class="tool-name">${tool}</span>
        <span class="tool-count">${count}</span>
      </li>
    `;
    })
    .join('');
}

/**
 * Render active issues as HTML
 */
function renderActiveIssues(issues: any[]): string {
  if (!issues || issues.length === 0) {
    return `<li class="empty">No active issues</li>`;
  }

  return issues
    .map(([issueId, timestamp]) => {
      return `
      <li>
        <div class="timestamp">${new Date(timestamp).toLocaleString()}</div>
        <div>Issue ID: ${issueId}</div>
      </li>
    `;
    })
    .join('');
}

/**
 * Render recent comments as HTML
 */
function renderComments(comments: any[]): string {
  if (!comments || comments.length === 0) {
    return `<li class="empty">No recent comments</li>`;
  }

  return comments
    .map((comment) => {
      return `
      <li>
        <div class="timestamp">${new Date(
          comment.timestamp
        ).toLocaleString()}</div>
        <div>Issue ID: ${comment.issueId}</div>
        <div class="comment-content">${
          comment.content.length > 100
            ? comment.content.substring(0, 100) + '...'
            : comment.content
        }</div>
      </li>
    `;
    })
    .join('');
}
