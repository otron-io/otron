import type { VercelRequest, VercelResponse } from '@vercel/node';
import { env } from '../lib/env.js';
import { withPasswordProtection } from '../lib/auth.js';

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
      .tab-button {
        transition: all 0.2s;
      }
      .tab-button.active {
        background-color: #3b82f6;
        color: white;
      }
      .conversation-bubble {
        max-width: 80%;
        word-wrap: break-word;
      }
      .conversation-bubble.user {
        background-color: #dbeafe;
        margin-left: auto;
      }
      .conversation-bubble.assistant {
        background-color: #f3f4f6;
        margin-right: auto;
      }
      .activity-feed {
        max-height: 500px;
        overflow-y: auto;
      }
      .status-badge {
        display: inline-flex;
        align-items: center;
        padding: 0.25rem 0.5rem;
        border-radius: 9999px;
        font-size: 0.75rem;
        font-weight: 500;
      }
      .status-active {
        background-color: #dcfce7;
        color: #166534;
      }
      .status-completed {
        background-color: #e0e7ff;
        color: #3730a3;
      }
      .platform-badge {
        display: inline-flex;
        align-items: center;
        padding: 0.125rem 0.375rem;
        border-radius: 0.375rem;
        font-size: 0.625rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .platform-slack {
        background-color: #4a154b;
        color: white;
      }
      .platform-linear {
        background-color: #5e6ad2;
        color: white;
      }
      .platform-github {
        background-color: #24292e;
        color: white;
      }
      .platform-general {
        background-color: #6b7280;
        color: white;
      }
    </style>
  </head>
  <body class="bg-gray-50 text-gray-900">
    <!-- Navigation Bar -->
    <nav class="bg-indigo-600 text-white shadow-md">
      <div class="max-w-7xl mx-auto px-4 py-3">
        <div class="flex justify-between items-center">
          <div class="flex items-center space-x-8">
            <a href="/pages/dashboard" class="text-lg font-bold">Otron</a>
            <div class="flex space-x-4">
              <a href="/pages/agent" class="px-3 py-2 rounded-md bg-indigo-700 font-medium">Agent Monitor</a>
              <a href="/pages/embed" class="px-3 py-2 rounded-md hover:bg-indigo-700 font-medium">Repository Embeddings</a>
            </div>
          </div>
        </div>
      </div>
    </nav>

    <div class="max-w-7xl mx-auto p-4 py-8">
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
        <div class="flex items-center">
          <label for="activeDays" class="mr-2">Active window:</label>
          <select id="activeDays" class="border rounded px-2 py-1">
            <option value="1">1 day</option>
            <option value="3">3 days</option>
            <option value="7" selected>7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
          </select>
        </div>
        <div class="flex items-center">
          <label for="includeAll" class="mr-2">
            <input type="checkbox" id="includeAll" class="mr-1">
            Show all historical data
          </label>
        </div>
        <div id="lastUpdated" class="ml-auto text-gray-500 self-center"></div>
      </div>
      
      <!-- Enhanced Summary Stats -->
      <div class="bg-white rounded-lg shadow-md p-6 mb-8">
        <h2 class="text-xl font-semibold mb-4">Agent Summary</h2>
        <div id="summaryContainer" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div class="bg-blue-50 rounded-lg p-4">
            <h3 class="text-lg font-medium text-blue-700">Active Contexts</h3>
            <p id="activeContextsCount" class="text-3xl font-bold">-</p>
          </div>
          <div class="bg-purple-50 rounded-lg p-4">
            <h3 class="text-lg font-medium text-purple-700">Completed Contexts</h3>
            <p id="completedContextsCount" class="text-3xl font-bold">-</p>
          </div>
          <div class="bg-green-50 rounded-lg p-4">
            <h3 class="text-lg font-medium text-green-700">Slack Conversations</h3>
            <p id="slackContextsCount" class="text-3xl font-bold">-</p>
          </div>
          <div class="bg-orange-50 rounded-lg p-4">
            <h3 class="text-lg font-medium text-orange-700">Linear Issues</h3>
            <p id="linearIssuesCount" class="text-3xl font-bold">-</p>
          </div>
          <div class="bg-indigo-50 rounded-lg p-4">
            <h3 class="text-lg font-medium text-indigo-700">Success Rate</h3>
            <p id="successRatePercent" class="text-3xl font-bold">-</p>
          </div>
        </div>
      </div>

      <!-- Main Content Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        <!-- Left Column: Tasks -->
        <div class="lg:col-span-2 space-y-8">
          
          <!-- Task Tabs -->
          <div class="bg-white rounded-lg shadow-md">
            <div class="border-b border-gray-200">
              <nav class="flex space-x-8 px-6 py-3">
                <button id="activeTasksTab" class="tab-button active px-3 py-2 rounded-md font-medium">
                  Active Contexts (<span id="activeTasksCount">0</span>)
                </button>
                <button id="completedTasksTab" class="tab-button px-3 py-2 rounded-md font-medium">
                  Completed Contexts (<span id="completedTasksCount">0</span>)
                </button>
              </nav>
            </div>
            
            <!-- Active Tasks Content -->
            <div id="activeTasksContent" class="p-6">
              <div id="activeIssuesContainer" class="space-y-4">
                <div class="text-center py-4 text-gray-500">Loading...</div>
              </div>
            </div>
            
            <!-- Completed Tasks Content -->
            <div id="completedTasksContent" class="p-6 hidden">
              <div id="completedIssuesContainer" class="space-y-4">
                <div class="text-center py-4 text-gray-500">Loading...</div>
              </div>
            </div>
          </div>
          
          <!-- Tool Usage -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-semibold mb-4">Tool Usage Statistics</h2>
            <div id="toolStatsContainer" class="space-y-4">
              <div class="text-center py-4 text-gray-500">Loading...</div>
            </div>
          </div>
        </div>
        
        <!-- Right Column: Activity Feed -->
        <div class="space-y-8">
          
          <!-- System Activity Feed -->
          <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-xl font-semibold mb-4">Recent System Activity</h2>
            <div id="systemActivityContainer" class="activity-feed space-y-3">
              <div class="text-center py-4 text-gray-500">Loading...</div>
            </div>
          </div>
          
        </div>
      </div>
    </div>

    <!-- Issue Detail Modal -->
    <div id="issueDetailModal" class="fixed inset-0 bg-gray-600 bg-opacity-50 hidden z-50">
      <div class="flex items-center justify-center min-h-screen p-4">
        <div class="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-screen overflow-hidden">
          <div class="flex justify-between items-center p-6 border-b">
            <h3 id="modalTitle" class="text-lg font-semibold">Issue Details</h3>
            <button id="closeModal" class="text-gray-400 hover:text-gray-600">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
          
          <!-- Modal Tabs -->
          <div class="border-b border-gray-200">
            <nav class="flex space-x-8 px-6 py-3">
              <button id="modalActionsTab" class="tab-button active px-3 py-2 rounded-md font-medium">Actions</button>
              <button id="modalConversationsTab" class="tab-button px-3 py-2 rounded-md font-medium">Conversations</button>
            </nav>
          </div>
          
          <div class="p-6 max-h-96 overflow-y-auto">
            <!-- Actions Content -->
            <div id="modalActionsContent">
              <div id="modalActionsContainer" class="space-y-3">
                <div class="text-center py-4 text-gray-500">Loading...</div>
              </div>
            </div>
            
            <!-- Conversations Content -->
            <div id="modalConversationsContent" class="hidden">
              <div id="modalConversationsContainer" class="space-y-3">
                <div class="text-center py-4 text-gray-500">Loading...</div>
              </div>
            </div>
          </div>
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

      // Global state
      let currentData = null;
      let currentModalIssueId = null;

      // Tab management
      function initializeTabs() {
        // Task tabs
        document.getElementById('activeTasksTab').addEventListener('click', () => {
          switchTaskTab('active');
        });
        
        document.getElementById('completedTasksTab').addEventListener('click', () => {
          switchTaskTab('completed');
        });

        // Modal tabs
        document.getElementById('modalActionsTab').addEventListener('click', () => {
          switchModalTab('actions');
        });
        
        document.getElementById('modalConversationsTab').addEventListener('click', () => {
          switchModalTab('conversations');
        });

        // Modal close
        document.getElementById('closeModal').addEventListener('click', closeModal);
        document.getElementById('issueDetailModal').addEventListener('click', (e) => {
          if (e.target.id === 'issueDetailModal') {
            closeModal();
          }
        });
      }

      function switchTaskTab(tab) {
        // Update tab buttons
        document.getElementById('activeTasksTab').classList.toggle('active', tab === 'active');
        document.getElementById('completedTasksTab').classList.toggle('active', tab === 'completed');
        
        // Update content visibility
        document.getElementById('activeTasksContent').classList.toggle('hidden', tab !== 'active');
        document.getElementById('completedTasksContent').classList.toggle('hidden', tab !== 'completed');
      }

      function switchModalTab(tab) {
        // Update tab buttons
        document.getElementById('modalActionsTab').classList.toggle('active', tab === 'actions');
        document.getElementById('modalConversationsTab').classList.toggle('active', tab === 'conversations');
        
        // Update content visibility
        document.getElementById('modalActionsContent').classList.toggle('hidden', tab !== 'actions');
        document.getElementById('modalConversationsContent').classList.toggle('hidden', tab !== 'conversations');
      }

      // Modal management
      function openIssueModal(contextId, contextTitle) {
        currentModalIssueId = contextId;
        document.getElementById('modalTitle').textContent = \`\${contextTitle || contextId} - Details\`;
        document.getElementById('issueDetailModal').classList.remove('hidden');
        
        // Load initial data
        loadModalData('actions');
        loadModalData('conversations');
      }

      function closeModal() {
        document.getElementById('issueDetailModal').classList.add('hidden');
        currentModalIssueId = null;
      }

      async function loadModalData(type) {
        if (!currentModalIssueId) return;

        try {
          const response = await fetch(\`/api/issue-details?issueId=\${encodeURIComponent(currentModalIssueId)}&type=\${type}&limit=50\`);
          const data = await response.json();

          if (type === 'actions') {
            renderModalActions(data.actions || []);
          } else if (type === 'conversations') {
            renderModalConversations(data.conversations || []);
          }
        } catch (error) {
          console.error(\`Error loading \${type}:\`, error);
        }
      }

      function renderModalActions(actions) {
        const container = document.getElementById('modalActionsContainer');
        
        if (actions.length === 0) {
          container.innerHTML = '<div class="text-center py-4 text-gray-500">No actions found</div>';
          return;
        }

        container.innerHTML = '';
        
        actions.forEach(action => {
          if (!action || !action.data) return;
          
          const actionDiv = document.createElement('div');
          actionDiv.className = 'border rounded-lg p-4 bg-gray-50';
          
          const timestamp = new Date(action.timestamp).toLocaleString();
          const success = action.data.success ? 
            '<span class="text-green-600">✓ Success</span>' : 
            '<span class="text-red-600">✗ Failed</span>';
          
          actionDiv.innerHTML = \`
            <div class="flex justify-between items-start mb-2">
              <div class="font-medium">\${action.data.tool || 'Unknown tool'}</div>
              <div class="text-sm text-gray-500">\${timestamp}</div>
            </div>
            <div class="mb-2">\${success}</div>
            <details class="mt-2">
              <summary class="cursor-pointer text-sm font-medium text-gray-700">View Details</summary>
              <div class="mt-2 space-y-2">
                <div>
                  <div class="text-xs font-medium text-gray-600">Input:</div>
                  <pre class="bg-white p-2 rounded text-xs overflow-x-auto max-h-32 overflow-y-auto">\${JSON.stringify(action.data.input, null, 2)}</pre>
                </div>
                <div>
                  <div class="text-xs font-medium text-gray-600">Response:</div>
                  <pre class="bg-white p-2 rounded text-xs overflow-x-auto max-h-32 overflow-y-auto">\${action.data.response || 'No response'}</pre>
                </div>
              </div>
            </details>
          \`;
          
          container.appendChild(actionDiv);
        });
      }

      function renderModalConversations(conversations) {
        const container = document.getElementById('modalConversationsContainer');
        
        if (conversations.length === 0) {
          container.innerHTML = '<div class="text-center py-4 text-gray-500">No conversations found</div>';
          return;
        }

        container.innerHTML = '';
        
        conversations.forEach(conv => {
          if (!conv || !conv.data) return;
          
          const convDiv = document.createElement('div');
          convDiv.className = \`conversation-bubble p-3 rounded-lg mb-3 \${conv.data.role === 'user' ? 'user' : 'assistant'}\`;
          
          const timestamp = new Date(conv.timestamp).toLocaleString();
          
          let content = '';
          if (conv.data.role === 'assistant' && Array.isArray(conv.data.content)) {
            content = conv.data.content
              .filter(block => block && block.type === 'text')
              .map(block => block.text || '')
              .join('\\n');
          } else if (typeof conv.data.content === 'string') {
            content = conv.data.content;
          } else {
            content = JSON.stringify(conv.data.content);
          }
          
          convDiv.innerHTML = \`
            <div class="text-xs text-gray-600 mb-1">\${conv.data.role === 'user' ? 'User' : 'Assistant'} • \${timestamp}</div>
            <div class="text-sm whitespace-pre-wrap">\${content}</div>
          \`;
          
          container.appendChild(convDiv);
        });
      }

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
          // Get values from UI controls
          const activeDays = document.getElementById('activeDays').value || '7';
          const includeAll = document.getElementById('includeAll').checked;
          
          // Build query parameters
          const params = new URLSearchParams({
            activeDays: activeDays,
            includeAll: includeAll.toString()
          });
          
          const response = await fetch(\`/api/agent-monitor?\${params.toString()}\`);
          
          if (!response.ok) {
            throw new Error(\`HTTP error! status: \${response.status}\`);
          }
          
          const data = await response.json();
          currentData = data;
          updateUI(data);
          
          // Update last updated text with query params info
          const queryInfo = data.queryParams ? 
            \` (Active: \${data.queryParams.activeDays}d, All: \${data.queryParams.includeAll})\` : '';
          document.getElementById('lastUpdated').textContent = \`Last updated: \${formatDateTime(Date.now())}\${queryInfo}\`;
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
        const { activeIssues, completedIssues, toolStats, systemActivity, summary, linearConnected } = data;
        
        // Update summary stats
        document.getElementById('activeContextsCount').textContent = summary.totalActiveContexts;
        document.getElementById('completedContextsCount').textContent = summary.totalCompletedContexts;
        document.getElementById('slackContextsCount').textContent = summary.totalSlackContexts;
        document.getElementById('linearIssuesCount').textContent = summary.totalLinearIssues;
        
        const successRate = summary.totalToolOperations > 0 
          ? Math.round((summary.totalSuccessfulOperations / summary.totalToolOperations) * 100) 
          : 0;
        document.getElementById('successRatePercent').textContent = \`\${successRate}%\`;

        // Update tab counts
        document.getElementById('activeTasksCount').textContent = activeIssues.length;
        document.getElementById('completedTasksCount').textContent = completedIssues.length;

        // Update active issues
        updateIssuesSection('activeIssuesContainer', activeIssues);
        
        // Update completed issues
        updateIssuesSection('completedIssuesContainer', completedIssues);
        
        // Update tool stats
        updateToolStats(toolStats);
        
        // Update system activity
        updateSystemActivity(systemActivity);
      }

      function updateIssuesSection(containerId, issues) {
        const container = document.getElementById(containerId);
        
        if (issues.length === 0) {
          container.innerHTML = \`
            <div class="text-center py-4 text-gray-500">
              No contexts found
            </div>
          \`;
          return;
        }

        container.innerHTML = '';
        
        // Sort contexts by most recent activity
        const sortedContexts = [...issues].sort((a, b) => b.lastActivity - a.lastActivity);
        
        for (const context of sortedContexts) {
          const contextCard = document.createElement('div');
          contextCard.className = 'bg-gray-50 rounded-lg p-4 cursor-pointer hover:bg-gray-100 transition-colors';
          
          // Add click handler to open modal
          contextCard.addEventListener('click', () => {
            const title = getContextDisplayTitle(context);
            openIssueModal(context.contextId, title);
          });
          
          // Create context header
          const header = document.createElement('div');
          header.className = 'flex justify-between items-start mb-3';
          
          // Format context info based on platform
          const contextInfo = document.createElement('div');
          
          if (context.platform === 'slack') {
            // Slack context display
            const channelDisplay = context.slackDetails ? 
              \`#\${context.slackDetails.channelId}\${context.slackDetails.isThread ? ' (thread)' : ''}\` : 
              context.displayName;
            
            contextInfo.innerHTML = \`
              <h3 class="font-medium text-indigo-600 flex items-center gap-2">
                <span class="platform-badge platform-slack">Slack</span>
                <span>\${channelDisplay}</span>
                <span class="status-badge \${context.status === 'active' ? 'status-active' : 'status-completed'}">
                  \${context.status}
                </span>
              </h3>
              <div class="text-sm text-gray-600 mt-1">
                Slack Conversation
                \${context.slackDetails?.isThread ? ' • Thread Discussion' : ' • Channel Discussion'}
              </div>
              <div class="text-xs text-gray-500 mt-1">
                Last Activity: \${timeAgo(context.lastActivity)}
                \${context.repository ? \` • Repository: <span class="font-medium">\${context.repository}</span>\` : ''}
              </div>
            \`;
          } else if (context.platform === 'linear' && context.issueDetails) {
            // Linear issue display
            const id = context.issueDetails.identifier || context.contextId;
            const title = context.issueDetails.title || 'Untitled';
            const state = context.issueDetails.state || 'Unknown';
            const priority = getPriorityLabel(context.issueDetails.priority);
            
            contextInfo.innerHTML = \`
              <h3 class="font-medium text-indigo-600 flex items-center gap-2">
                <span class="platform-badge platform-linear">Linear</span>
                <span>\${id}</span>
                <span class="status-badge \${context.status === 'active' ? 'status-active' : 'status-completed'}">
                  \${context.status}
                </span>
              </h3>
              <div class="text-sm font-medium mt-1">\${title}</div>
              <div class="flex mt-2 space-x-2 text-xs">
                <span class="px-2 py-1 bg-gray-200 text-gray-800 rounded-full">\${state}</span>
                <span class="px-2 py-1 bg-gray-200 text-gray-800 rounded-full">\${priority}</span>
                \${context.issueDetails.assignee ? \`<span class="px-2 py-1 bg-gray-200 text-gray-800 rounded-full">Assigned: \${context.issueDetails.assignee}</span>\` : ''}
              </div>
              <div class="text-xs text-gray-500 mt-1">
                Last Activity: \${timeAgo(context.lastActivity)}
                \${context.repository ? \` • Repository: <span class="font-medium">\${context.repository}</span>\` : ''}
              </div>
            \`;
          } else {
            // General context display (fallback)
            const platformBadge = context.platform === 'linear' ? 'platform-linear' : 
                                 context.platform === 'slack' ? 'platform-slack' : 
                                 context.platform === 'github' ? 'platform-github' : 'platform-general';
            
            contextInfo.innerHTML = \`
              <h3 class="font-medium text-indigo-600 flex items-center gap-2">
                <span class="platform-badge \${platformBadge}">\${context.platform}</span>
                <span>\${context.displayName}</span>
                <span class="status-badge \${context.status === 'active' ? 'status-active' : 'status-completed'}">
                  \${context.status}
                </span>
              </h3>
              <div class="text-sm text-gray-600 mt-1">
                \${context.contextType.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
              </div>
              <div class="text-xs text-gray-500 mt-1">
                Last Activity: \${timeAgo(context.lastActivity)}
                \${context.repository ? \` • Repository: <span class="font-medium">\${context.repository}</span>\` : ''}
              </div>
            \`;
          }
          
          const statsInfo = document.createElement('div');
          statsInfo.className = 'text-right';
          statsInfo.innerHTML = \`
            <div class="text-xs font-medium px-2 py-1 bg-blue-100 text-blue-800 rounded-full mb-1">
              \${context.actionsCount} actions
            </div>
            <div class="text-xs font-medium px-2 py-1 bg-purple-100 text-purple-800 rounded-full">
              \${context.conversationCount} conversations
            </div>
          \`;
          
          header.appendChild(contextInfo);
          header.appendChild(statsInfo);
          
          // Create GitHub details if available
          if (context.branchDetails || context.pullRequests) {
            const githubDetails = document.createElement('div');
            githubDetails.className = 'mb-3 mt-2 p-2 bg-gray-100 rounded';
            
            let githubHtml = '<div class="text-sm font-medium text-gray-700">GitHub Resources</div><div class="mt-1 space-y-1">';
            
            if (context.branchDetails) {
              githubHtml += \`
                <div class="text-xs">
                  <span class="font-medium">Branch:</span> 
                  \${context.branchDetails.repository}:\${context.branchDetails.branch}
                </div>
              \`;
            }
            
            if (context.pullRequests && context.pullRequests.length > 0) {
              for (const pr of context.pullRequests) {
                githubHtml += \`
                  <div class="text-xs">
                    <span class="font-medium">Pull Request:</span> 
                    <a href="\${pr.url}" target="_blank" class="text-indigo-600 hover:underline" onclick="event.stopPropagation()">
                      \${pr.owner}/\${pr.repo} #\${pr.number}
                    </a>
                  </div>
                \`;
              }
            }
            
            githubHtml += '</div>';
            githubDetails.innerHTML = githubHtml;
            contextCard.appendChild(githubDetails);
          }
          
          contextCard.appendChild(header);
          container.appendChild(contextCard);
        }
      }

      // Helper function to get display title for context
      function getContextDisplayTitle(context) {
        if (context.platform === 'slack') {
          return context.slackDetails ? 
            \`Slack: #\${context.slackDetails.channelId}\${context.slackDetails.isThread ? ' (thread)' : ''}\` : 
            \`Slack: \${context.displayName}\`;
        } else if (context.platform === 'linear' && context.issueDetails) {
          return \`\${context.issueDetails.identifier}: \${context.issueDetails.title}\`;
        } else {
          return \`\${context.platform}: \${context.displayName}\`;
        }
      }

      function updateToolStats(toolStats) {
        const toolStatsContainer = document.getElementById('toolStatsContainer');
        
        const toolNames = Object.keys(toolStats);
        if (toolNames.length === 0) {
          toolStatsContainer.innerHTML = \`
            <div class="text-center py-4 text-gray-500">
              No tool usage data found
            </div>
          \`;
          return;
        }

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

      function updateSystemActivity(activities) {
        const container = document.getElementById('systemActivityContainer');
        
        if (!activities || activities.length === 0) {
          container.innerHTML = '<div class="text-center py-4 text-gray-500">No recent activity</div>';
          return;
        }

        container.innerHTML = '';
        
        activities.forEach(activity => {
          if (!activity || !activity.data) return;
          
          const activityDiv = document.createElement('div');
          activityDiv.className = 'border-l-4 border-blue-500 pl-3 py-2 bg-gray-50 rounded-r';
          
          const timestamp = new Date(activity.timestamp).toLocaleTimeString();
          const success = activity.data.success ? 
            '<span class="text-green-600 text-xs">✓</span>' : 
            '<span class="text-red-600 text-xs">✗</span>';
          
          // Determine platform and context info
          const contextId = activity.issueId || 'unknown';
          const isSlackContext = contextId.startsWith('slack:');
          const isLinearContext = !isSlackContext && (/^[A-Z]{2,}-\d+$/.test(contextId) || /^[a-f0-9-]{36}$/.test(contextId));
          
          let platformBadge = '';
          let contextDisplay = contextId;
          
          if (isSlackContext) {
            platformBadge = '<span class="platform-badge platform-slack mr-1">Slack</span>';
            const slackParts = contextId.split(':');
            if (slackParts.length >= 2) {
              const channelId = slackParts[1];
              const isThread = slackParts.length > 2;
              contextDisplay = \`#\${channelId}\${isThread ? ' (thread)' : ''}\`;
            }
          } else if (isLinearContext) {
            platformBadge = '<span class="platform-badge platform-linear mr-1">Linear</span>';
            contextDisplay = /^[A-Z]{2,}-\d+$/.test(contextId) ? contextId : \`Issue \${contextId.substring(0, 8)}...\`;
          } else {
            platformBadge = '<span class="platform-badge platform-general mr-1">General</span>';
          }
          
          activityDiv.innerHTML = \`
            <div class="flex justify-between items-start">
              <div class="flex-1">
                <div class="text-sm font-medium">
                  \${activity.data.tool || 'Unknown'} \${success}
                </div>
                <div class="text-xs text-gray-600 flex items-center">
                  \${platformBadge}
                  \${contextDisplay}
                </div>
              </div>
              <div class="text-xs text-gray-500">\${timestamp}</div>
            </div>
          \`;
          
          container.appendChild(activityDiv);
        });
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

      // Filter controls event listeners
      document.getElementById('activeDays').addEventListener('change', fetchAgentData);
      document.getElementById('includeAll').addEventListener('change', fetchAgentData);

      // Initialize everything
      document.addEventListener('DOMContentLoaded', function() {
        initializeTabs();
        fetchAgentData();
      });
    </script>
  </body>
  </html>
  `;

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
}

// Export the handler with password protection
export default withPasswordProtection(handler);
