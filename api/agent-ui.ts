import type { VercelRequest, VercelResponse } from '@vercel/node';
import { env } from '../src/env.js';
import { withPasswordProtection } from '../src/utils/auth.js';

/**
 * HTML UI for monitoring Otron agent activities
 */
async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Build the UI HTML
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Otron Agent Monitor</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      .log-container {
        max-height: 400px;
        overflow-y: auto;
        background-color: #f3f4f6;
        border-radius: 0.375rem;
        font-family: ui-monospace, monospace;
        font-size: 0.875rem;
        line-height: 1.25rem;
        white-space: pre-wrap;
        word-break: break-all;
      }
      .tool-bar {
        height: 12px;
        border-radius: 9999px;
        transition: width 0.5s;
      }
      .bg-success {
        background-color: #10b981;
      }
      .bg-failure {
        background-color: #ef4444;
      }
    </style>
  </head>
  <body class="bg-gray-50 text-gray-900">
    <!-- Navigation Bar -->
    <nav class="bg-indigo-600 text-white shadow-md">
      <div class="max-w-6xl mx-auto px-4 py-3">
        <div class="flex justify-between items-center">
          <div class="flex items-center space-x-8">
            <a href="/api/dashboard" class="text-lg font-bold">Otron</a>
            <div class="flex space-x-4">
              <a href="/pages/agent" class="px-3 py-2 rounded-md bg-indigo-700 font-medium">Agent Monitor</a>
              <a href="/pages/embed" class="px-3 py-2 rounded-md hover:bg-indigo-700 font-medium">Repository Embeddings</a>
            </div>
          </div>
        </div>
      </div>
    </nav>

    <div class="max-w-6xl mx-auto p-4 py-8">
      <h1 class="text-3xl font-bold text-gray-900 mb-8 flex items-center">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        Otron Agent Monitor
      </h1>
      
      <div class="flex gap-4 mb-4">
        <button id="refreshButton" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition">
          Refresh Data
        </button>
        <div class="flex items-center">
          <label for="autoRefresh" class="mr-2">Auto-refresh:</label>
          <select id="autoRefresh" class="border rounded px-2 py-1">
            <option value="0">Off</option>
            <option value="5000">5 seconds</option>
            <option value="10000">10 seconds</option>
            <option value="30000">30 seconds</option>
            <option value="60000">1 minute</option>
          </select>
        </div>
        <div id="lastUpdated" class="ml-auto text-gray-500 self-center"></div>
      </div>
      
      <!-- Summary Stats -->
      <div class="bg-white rounded-lg shadow-md p-6 mb-8">
        <h2 class="text-xl font-semibold mb-4">Agent Summary</h2>
        <div id="summaryContainer" class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="bg-blue-50 rounded-lg p-4">
            <h3 class="text-lg font-medium text-blue-700">Active Issues</h3>
            <p id="activeIssuesCount" class="text-3xl font-bold">-</p>
          </div>
          <div class="bg-green-50 rounded-lg p-4">
            <h3 class="text-lg font-medium text-green-700">Tool Operations</h3>
            <p id="toolOperationsCount" class="text-3xl font-bold">-</p>
          </div>
          <div class="bg-purple-50 rounded-lg p-4">
            <h3 class="text-lg font-medium text-purple-700">Success Rate</h3>
            <p id="successRatePercent" class="text-3xl font-bold">-</p>
          </div>
        </div>
      </div>
      
      <!-- Active Issues -->
      <div class="bg-white rounded-lg shadow-md p-6 mb-8">
        <h2 class="text-xl font-semibold mb-4">Active Issues</h2>
        <div id="activeIssuesContainer" class="space-y-4">
          <div class="text-center py-4 text-gray-500">Loading...</div>
        </div>
      </div>
      
      <!-- Tool Usage -->
      <div class="bg-white rounded-lg shadow-md p-6 mb-8">
        <h2 class="text-xl font-semibold mb-4">Tool Usage Statistics</h2>
        <div id="toolStatsContainer" class="space-y-4">
          <div class="text-center py-4 text-gray-500">Loading...</div>
        </div>
      </div>
    </div>
    
    <script>
      // Add internal token to all fetch requests to API endpoints
      const internalToken = "${env.INTERNAL_API_TOKEN}";
      const originalFetch = window.fetch;
      window.fetch = function(url, options = {}) {
        // Only add token for our API endpoints
        if (typeof url === 'string' && url.startsWith('/api/')) {
          options = options || {};
          options.headers = options.headers || {};
          options.headers['X-Internal-Token'] = internalToken;
        }
        return originalFetch(url, options);
      };

      // Format timestamp as readable date/time
      function formatDateTime(timestamp) {
        return new Date(timestamp).toLocaleString();
      }

      // Format time elapsed since timestamp
      function timeAgo(timestamp) {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        
        if (seconds < 60) {
          return \`\${seconds} seconds ago\`;
        }
        
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) {
          return \`\${minutes} \${minutes === 1 ? 'minute' : 'minutes'} ago\`;
        }
        
        const hours = Math.floor(minutes / 60);
        if (hours < 24) {
          return \`\${hours} \${hours === 1 ? 'hour' : 'hours'} ago\`;
        }
        
        const days = Math.floor(hours / 24);
        return \`\${days} \${days === 1 ? 'day' : 'days'} ago\`;
      }

      // Update UI with agent data
      async function fetchAgentData() {
        try {
          const response = await fetch('/api/agent-monitor');
          
          if (!response.ok) {
            throw new Error(\`HTTP error! status: \${response.status}\`);
          }
          
          const data = await response.json();
          updateUI(data);
          
          // Update last updated text
          document.getElementById('lastUpdated').textContent = \`Last updated: \${formatDateTime(Date.now())}\`;
        } catch (error) {
          console.error('Error fetching agent data:', error);
          document.getElementById('activeIssuesContainer').innerHTML = \`
            <div class="text-center py-4 text-red-500">
              Error loading data: \${error.message}
            </div>
          \`;
        }
      }

      // Update UI elements with fetched data
      function updateUI(data) {
        const { activeIssues, toolStats, timestamp, linearConnected } = data;
        
        // Show Linear connection status
        const summaryContainer = document.getElementById('summaryContainer');
        const linearStatusElement = document.getElementById('linearStatus');
        if (!linearStatusElement) {
          const linearStatusDiv = document.createElement('div');
          linearStatusDiv.id = 'linearStatus';
          linearStatusDiv.className = 'bg-gray-50 rounded-lg p-4';
          
          const linearLabel = document.createElement('h3');
          linearLabel.className = 'text-lg font-medium text-gray-700';
          linearLabel.textContent = 'Linear Connection';
          linearStatusDiv.appendChild(linearLabel);
          
          const statusText = document.createElement('p');
          statusText.id = 'linearStatusText';
          statusText.className = 'text-3xl font-bold ' + (linearConnected ? 'text-green-600' : 'text-red-600');
          statusText.textContent = linearConnected ? 'Connected' : 'Disconnected';
          linearStatusDiv.appendChild(statusText);
          
          summaryContainer.appendChild(linearStatusDiv);
        } else {
          const statusText = document.getElementById('linearStatusText');
          if (statusText) {
            statusText.className = 'text-3xl font-bold ' + (linearConnected ? 'text-green-600' : 'text-red-600');
            statusText.textContent = linearConnected ? 'Connected' : 'Disconnected';
          }
        }

        // Update summary stats
        document.getElementById('activeIssuesCount').textContent = activeIssues.length;
        
        // Calculate tool operations stats
        let totalOperations = 0;
        let totalSuccesses = 0;
        
        for (const tool in toolStats) {
          const stats = toolStats[tool];
          totalOperations += parseInt(stats.attempts);
          totalSuccesses += parseInt(stats.successes);
        }
        
        document.getElementById('toolOperationsCount').textContent = totalOperations;
        
        const successRate = totalOperations > 0 
          ? Math.round((totalSuccesses / totalOperations) * 100) 
          : 0;
        document.getElementById('successRatePercent').textContent = \`\${successRate}%\`;
        
        // Update active issues section
        const issuesContainer = document.getElementById('activeIssuesContainer');
        
        if (activeIssues.length === 0) {
          issuesContainer.innerHTML = \`
            <div class="text-center py-4 text-gray-500">
              No active issues found
            </div>
          \`;
        } else {
          issuesContainer.innerHTML = '';
          
          // Sort issues by most recent activity
          const sortedIssues = [...activeIssues].sort((a, b) => b.lastActivity - a.lastActivity);
          
          for (const issue of sortedIssues) {
            const issueCard = document.createElement('div');
            issueCard.className = 'bg-gray-50 rounded-lg p-4';
            
            // Create issue header
            const header = document.createElement('div');
            header.className = 'flex justify-between items-start mb-3';
            
            // Format issue info with Linear data if available
            const issueInfo = document.createElement('div');
            
            if (issue.issueDetails) {
              const id = issue.issueDetails.identifier || issue.issueId;
              const title = issue.issueDetails.title || 'Untitled';
              const state = issue.issueDetails.state || 'Unknown';
              const priority = getPriorityLabel(issue.issueDetails.priority);
              const url = issue.issueDetails.url;
              
              issueInfo.innerHTML = \`
                <h3 class="font-medium text-indigo-600">
                  <a href="\${url}" target="_blank" class="hover:underline flex items-center">
                    <span>Issue: \${id}</span>
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 ml-1" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                      <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                    </svg>
                  </a>
                </h3>
                <div class="text-sm font-medium mt-1">\${title}</div>
                <div class="flex mt-2 space-x-2 text-xs">
                  <span class="px-2 py-1 bg-gray-200 text-gray-800 rounded-full">\${state}</span>
                  <span class="px-2 py-1 bg-gray-200 text-gray-800 rounded-full">\${priority}</span>
                  \${issue.issueDetails.assignee ? \`<span class="px-2 py-1 bg-gray-200 text-gray-800 rounded-full">Assigned: \${issue.issueDetails.assignee}</span>\` : ''}
                </div>
                <div class="text-xs text-gray-500 mt-1">
                  Last Activity: \${timeAgo(issue.lastActivity)} • 
                  Repository: \${
                    issue.repository ? 
                    \`<span class="font-medium">\${issue.repository}</span>\` : 
                    'Unknown'
                  }
                </div>
              \`;
            } else {
              // Fallback to old format if no Linear data
              issueInfo.innerHTML = \`
                <h3 class="font-medium text-indigo-600">Issue: \${issue.issueId}</h3>
                <div class="text-sm text-gray-500">
                  Last Activity: \${timeAgo(issue.lastActivity)} •
                  Repository: \${issue.repository || 'Unknown'}
                </div>
              \`;
            }
            
            const actionsCount = document.createElement('div');
            actionsCount.className = 'text-xs font-medium px-2 py-1 bg-blue-100 text-blue-800 rounded-full';
            actionsCount.textContent = \`\${issue.actionsCount} actions\`;
            
            header.appendChild(issueInfo);
            header.appendChild(actionsCount);
            
            // Create GitHub details if available
            if (issue.branchDetails || issue.pullRequests) {
              const githubDetails = document.createElement('div');
              githubDetails.className = 'mb-3 mt-2 p-2 bg-gray-100 rounded';
              
              let githubHtml = '<div class="text-sm font-medium text-gray-700">GitHub Resources</div><div class="mt-1 space-y-1">';
              
              if (issue.branchDetails) {
                githubHtml += \`
                  <div class="text-xs">
                    <span class="font-medium">Branch:</span> 
                    \${issue.branchDetails.repository}:\${issue.branchDetails.branch}
                  </div>
                \`;
              }
              
              if (issue.pullRequests && issue.pullRequests.length > 0) {
                for (const pr of issue.pullRequests) {
                  githubHtml += \`
                    <div class="text-xs">
                      <span class="font-medium">Pull Request:</span> 
                      <a href="\${pr.url}" target="_blank" class="text-indigo-600 hover:underline">
                        \${pr.owner}/\${pr.repo} #\${pr.number}
                      </a>
                    </div>
                  \`;
                }
              }
              
              githubHtml += '</div>';
              githubDetails.innerHTML = githubHtml;
              issueCard.appendChild(githubDetails);
            }
            
            // Create recent actions list
            const actionsList = document.createElement('div');
            actionsList.className = 'space-y-2 mt-3';
            
            const actionsTitle = document.createElement('div');
            actionsTitle.className = 'text-sm font-medium text-gray-700 mb-2 flex justify-between items-center';
            const titleText = document.createElement('span');
            titleText.textContent = 'Recent Actions';
            
            // Add expand/collapse all button
            const expandAllButton = document.createElement('button');
            expandAllButton.className = 'text-xs bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded text-gray-700';
            expandAllButton.textContent = 'Expand All';
            expandAllButton.addEventListener('click', function() {
              // Get all content sections in this issue card
              const issueCard = this.closest('.bg-gray-50');
              const contentSections = issueCard.querySelectorAll('.action-content');
              const icons = issueCard.querySelectorAll('.expand-icon');
              
              // Check if we should expand or collapse
              const shouldExpand = this.textContent === 'Expand All';
              
              // Update all content sections
              contentSections.forEach(section => {
                section.classList.toggle('hidden', !shouldExpand);
              });
              
              // Update all icons
              icons.forEach(icon => {
                icon.textContent = shouldExpand ? '▼' : '▶';
              });
              
              // Update button text
              this.textContent = shouldExpand ? 'Collapse All' : 'Expand All';
            });
            
            actionsTitle.appendChild(titleText);
            actionsTitle.appendChild(expandAllButton);
            actionsList.appendChild(actionsTitle);
            
            if (issue.recentActions && issue.recentActions.length > 0) {
              issue.recentActions.forEach(action => {
                if (!action || !action.data) return;
                
                const actionItem = document.createElement('div');
                actionItem.className = 'text-sm border-l-2 border-gray-300 pl-3 action-item';
                
                const actionTimestamp = new Date(action.timestamp).toLocaleTimeString();
                const success = action.data.success ? 
                  '<span class="text-green-600">✓</span>' : 
                  '<span class="text-red-600">✗</span>';
                
                // Create header with tool name, success indicator, and timestamp
                const header = document.createElement('div');
                header.className = 'flex justify-between items-center cursor-pointer hover:bg-gray-100 p-1 rounded';
                header.onclick = function() {
                  const content = this.nextElementSibling;
                  content.classList.toggle('hidden');
                  const expandIcon = this.querySelector('.expand-icon');
                  if (expandIcon) {
                    expandIcon.textContent = content.classList.contains('hidden') ? '▶' : '▼';
                  }
                };
                
                // Create header content
                const headerLeft = document.createElement('div');
                headerLeft.innerHTML = \`
                  <span class="expand-icon mr-1">▶</span>
                  <span class="font-medium">\${action.data.tool || 'Unknown tool'}</span> \${success}
                \`;
                
                const headerRight = document.createElement('span');
                headerRight.className = 'text-gray-500 text-xs';
                headerRight.textContent = actionTimestamp;
                
                header.appendChild(headerLeft);
                header.appendChild(headerRight);
                
                // Create expandable content section
                const contentSection = document.createElement('div');
                contentSection.className = 'mt-1 ml-3 hidden action-content';
                
                // Format the input data for better display
                let inputDisplay = '';
                if (action.data.input) {
                  if (typeof action.data.input === 'object') {
                    inputDisplay = \`<pre class="bg-gray-100 p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">\${JSON.stringify(action.data.input, null, 2)}</pre>\`;
                  } else {
                    inputDisplay = \`<pre class="bg-gray-100 p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">\${action.data.input}</pre>\`;
                  }
                } else {
                  inputDisplay = '<div class="text-gray-500 italic">No input data</div>';
                }
                
                // Format the response for better display
                let responseDisplay = '';
                if (action.data.response) {
                  responseDisplay = \`<pre class="bg-gray-100 p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">\${action.data.response}</pre>\`;
                } else {
                  responseDisplay = '<div class="text-gray-500 italic">No response data</div>';
                }
                
                contentSection.innerHTML = \`
                  <div class="mb-2">
                    <div class="font-medium text-xs mb-1">Input:</div>
                    \${inputDisplay}
                  </div>
                  <div>
                    <div class="font-medium text-xs mb-1">Response:</div>
                    \${responseDisplay}
                  </div>
                \`;
                
                // Add header and content to the action item
                actionItem.appendChild(header);
                actionItem.appendChild(contentSection);
                actionsList.appendChild(actionItem);
              });
            } else {
              actionsList.innerHTML += '<div class="text-gray-500 text-sm">No recent actions</div>';
            }
            
            // Add "Show More" button if there are more actions than what we're showing
            if (issue.actionsCount > issue.recentActions.length) {
              const showMoreContainer = document.createElement('div');
              showMoreContainer.className = 'mt-3 text-center';
              
              const showMoreButton = document.createElement('button');
              showMoreButton.className = 'text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 font-medium py-1 px-3 rounded';
              showMoreButton.textContent = \`Show More (\${issue.recentActions.length}/\${issue.actionsCount})\`;
              
              showMoreButton.addEventListener('click', async function() {
                try {
                  // Disable button and show loading state
                  this.disabled = true;
                  this.textContent = 'Loading...';
                  
                  // Fetch more actions for this issue
                  const response = await fetch(\`/api/issue-actions?issueId=\${issue.issueId}&skip=\${issue.recentActions.length}&limit=20\`);
                  
                  if (!response.ok) {
                    throw new Error(\`Error: \${response.status}\`);
                  }
                  
                  const data = await response.json();
                  
                  if (data.actions && data.actions.length > 0) {
                    // Process and append the new actions
                    data.actions.forEach(action => {
                      if (!action || !action.data) return;
                      
                      const actionItem = document.createElement('div');
                      actionItem.className = 'text-sm border-l-2 border-gray-300 pl-3 action-item';
                      
                      const actionTimestamp = new Date(action.timestamp).toLocaleTimeString();
                      const success = action.data.success ? 
                        '<span class="text-green-600">✓</span>' : 
                        '<span class="text-red-600">✗</span>';
                      
                      // Create header with tool name, success indicator, and timestamp
                      const header = document.createElement('div');
                      header.className = 'flex justify-between items-center cursor-pointer hover:bg-gray-100 p-1 rounded';
                      header.onclick = function() {
                        const content = this.nextElementSibling;
                        content.classList.toggle('hidden');
                        const expandIcon = this.querySelector('.expand-icon');
                        if (expandIcon) {
                          expandIcon.textContent = content.classList.contains('hidden') ? '▶' : '▼';
                        }
                      };
                      
                      // Create header content
                      const headerLeft = document.createElement('div');
                      headerLeft.innerHTML = \`
                        <span class="expand-icon mr-1">▶</span>
                        <span class="font-medium">\${action.data.tool || 'Unknown tool'}</span> \${success}
                      \`;
                      
                      const headerRight = document.createElement('span');
                      headerRight.className = 'text-gray-500 text-xs';
                      headerRight.textContent = actionTimestamp;
                      
                      header.appendChild(headerLeft);
                      header.appendChild(headerRight);
                      
                      // Create expandable content section
                      const contentSection = document.createElement('div');
                      contentSection.className = 'mt-1 ml-3 hidden action-content';
                      
                      // Format the input data for better display
                      let inputDisplay = '';
                      if (action.data.input) {
                        if (typeof action.data.input === 'object') {
                          inputDisplay = \`<pre class="bg-gray-100 p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">\${JSON.stringify(action.data.input, null, 2)}</pre>\`;
                        } else {
                          inputDisplay = \`<pre class="bg-gray-100 p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">\${action.data.input}</pre>\`;
                        }
                      } else {
                        inputDisplay = '<div class="text-gray-500 italic">No input data</div>';
                      }
                      
                      // Format the response for better display
                      let responseDisplay = '';
                      if (action.data.response) {
                        responseDisplay = \`<pre class="bg-gray-100 p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">\${action.data.response}</pre>\`;
                      } else {
                        responseDisplay = '<div class="text-gray-500 italic">No response data</div>';
                      }
                      
                      contentSection.innerHTML = \`
                        <div class="mb-2">
                          <div class="font-medium text-xs mb-1">Input:</div>
                          \${inputDisplay}
                        </div>
                        <div>
                          <div class="font-medium text-xs mb-1">Response:</div>
                          \${responseDisplay}
                        </div>
                      \`;
                      
                      // Add header and content to the action item
                      actionItem.appendChild(header);
                      actionItem.appendChild(contentSection);
                      actionsList.appendChild(actionItem);
                    });
                    
                    // Update the issue's recentActions array
                    issue.recentActions = issue.recentActions.concat(data.actions);
                    
                    // Update the button text
                    this.textContent = \`Show More (\${issue.recentActions.length}/\${issue.actionsCount})\`;
                    this.disabled = false;
                    
                    // If we've loaded all actions, remove the button
                    if (issue.recentActions.length >= issue.actionsCount) {
                      showMoreContainer.remove();
                    }
                  } else {
                    // No more actions or none returned
                    this.textContent = 'No more actions';
                    setTimeout(() => {
                      showMoreContainer.remove();
                    }, 2000);
                  }
                } catch (error) {
                  console.error('Error loading more actions:', error);
                  this.textContent = 'Error loading actions';
                  this.disabled = false;
                }
              });
              
              showMoreContainer.appendChild(showMoreButton);
              actionsList.appendChild(showMoreContainer);
            }
            
            issueCard.appendChild(header);
            issueCard.appendChild(actionsList);
            issuesContainer.appendChild(issueCard);
          }
        }
        
        // Update tool stats section
        const toolStatsContainer = document.getElementById('toolStatsContainer');
        
        const toolNames = Object.keys(toolStats);
        if (toolNames.length === 0) {
          toolStatsContainer.innerHTML = \`
            <div class="text-center py-4 text-gray-500">
              No tool usage data found
            </div>
          \`;
        } else {
          toolStatsContainer.innerHTML = '';
          
          // Sort tools by usage
          const sortedTools = toolNames.sort((a, b) => {
            return (
              parseInt(toolStats[b].attempts) - parseInt(toolStats[a].attempts)
            );
          });
          
          for (const toolName of sortedTools) {
            const stats = toolStats[toolName];
            const attempts = parseInt(stats.attempts);
            const successes = parseInt(stats.successes);
            
            if (attempts === 0) continue;
            
            const successRate = Math.round((successes / attempts) * 100);
            
            const toolCard = document.createElement('div');
            toolCard.className = 'bg-gray-50 rounded-lg p-4';
            
            toolCard.innerHTML = \`
              <div class="flex justify-between items-center mb-2">
                <h3 class="font-medium">\${formatToolName(toolName)}</h3>
                <div class="text-sm text-gray-700">\${successes} / \${attempts} (\${successRate}% success)</div>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                <div class="flex h-full">
                  <div class="tool-bar bg-success" style="width: \${successRate}%"></div>
                  <div class="tool-bar bg-failure" style="width: \${100 - successRate}%"></div>
                </div>
              </div>
            \`;
            
            toolStatsContainer.appendChild(toolCard);
          }
        }
      }

      // Helper function to display priority in a readable format
      function getPriorityLabel(priority) {
        switch(priority) {
          case 0: return 'No Priority';
          case 1: return 'Priority: Urgent';
          case 2: return 'Priority: High';
          case 3: return 'Priority: Medium';
          case 4: return 'Priority: Low';
          default: return 'Unknown Priority';
        }
      }
      
      // Helper to format tool names in a more readable way
      function formatToolName(toolName) {
        return toolName
          // Add space before capital letters
          .replace(/([A-Z])/g, ' $1')
          // Capitalize first letter
          .replace(/^./, (str) => str.toUpperCase())
          .trim();
      }

      // Refresh button click handler
      document.getElementById('refreshButton').addEventListener('click', fetchAgentData);
      
      // Auto-refresh functionality
      let refreshInterval = null;
      
      document.getElementById('autoRefresh').addEventListener('change', function() {
        const interval = parseInt(this.value);
        
        // Clear existing interval if any
        if (refreshInterval) {
          clearInterval(refreshInterval);
          refreshInterval = null;
        }
        
        // Set new interval if not disabled
        if (interval > 0) {
          refreshInterval = setInterval(fetchAgentData, interval);
        }
      });

      // Initial data fetch
      fetchAgentData();
    </script>
  </body>
  </html>
  `;

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
}

// Export the handler with password protection
export default withPasswordProtection(handler);
