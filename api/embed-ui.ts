import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { env } from '../src/env.js';
import { withPasswordProtection } from '../src/auth.js';

// Initialize Redis client
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

/**
 * Simple HTML UI for managing repository embeddings and search
 */
async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get list of embedded repositories
  const keys = await redis.keys('embedding:repo:*:status');
  const repositories: any[] = [];

  for (const key of keys) {
    const repoStatus = await redis.get(key);
    if (repoStatus) {
      try {
        // Try to parse as JSON, but handle if it's already an object or malformed
        let parsedStatus: any;

        if (typeof repoStatus === 'object' && repoStatus !== null) {
          // Already an object, no need to parse
          parsedStatus = repoStatus;
        } else if (typeof repoStatus === 'string') {
          // Fix for "[object Object]" string issue
          if (repoStatus === '[object Object]') {
            console.warn(
              `Found invalid repository status for ${key}, skipping`
            );
            continue;
          }

          try {
            parsedStatus = JSON.parse(repoStatus);
          } catch (parseError) {
            console.error(
              `Error parsing repository status for ${key}: ${parseError}`
            );
            continue;
          }
        } else {
          console.error(
            `Unexpected repository status type for ${key}: ${typeof repoStatus}`
          );
          continue;
        }

        // Additional validation
        if (!parsedStatus.repository || !parsedStatus.status) {
          console.warn(
            `Invalid repository status data for ${key}, missing required fields`
          );
          continue;
        }

        repositories.push(parsedStatus);
      } catch (e) {
        console.error(`Error processing repository status for ${key}: ${e}`);
      }
    }
  }

  // Debug log to help troubleshoot
  console.log(
    `Found ${repositories.length} repositories from ${keys.length} keys`
  );

  // Sort by most recently processed
  repositories.sort((a, b) => b.lastProcessedAt - a.lastProcessedAt);

  // Build the UI HTML
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Code Repository Embeddings</title>
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
      .progress-bar {
        height: 8px;
        border-radius: 9999px;
        background-color: #4f46e5;
        transition: width 0.5s;
      }
    </style>
  </head>
  <body class="bg-gray-50 text-gray-900">
    <div class="max-w-6xl mx-auto p-4 py-8">
      <h1 class="text-3xl font-bold text-gray-900 mb-8 flex items-center">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        Code Repository Embeddings
      </h1>
      
      <!-- Embed New Repository -->
      <div class="bg-white rounded-lg shadow-md p-6 mb-8">
        <h2 class="text-xl font-semibold mb-4">Embed a Repository</h2>
        <form id="embedForm" class="space-y-4">
          <div>
            <label for="repository" class="block text-sm font-medium text-gray-700 mb-1">Repository (owner/repo format)</label>
            <input type="text" id="repository" name="repository" placeholder="e.g., username/repository" 
              class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500">
          </div>
          <div class="flex items-center">
            <input type="checkbox" id="resume" name="resume" checked class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded">
            <label for="resume" class="ml-2 block text-sm text-gray-700">Resume from checkpoint if available</label>
          </div>
          <div>
            <button type="submit" class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
              <svg xmlns="http://www.w3.org/2000/svg" class="-ml-1 mr-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Start Embedding
            </button>
          </div>
        </form>
        
        <!-- Progress Display -->
        <div id="progressContainer" class="mt-6 hidden">
          <h3 class="text-sm font-semibold text-gray-700 mb-2">Embedding Progress</h3>
          <div class="w-full bg-gray-200 rounded-full h-2 mb-2">
            <div id="progressBar" class="progress-bar" style="width: 0%"></div>
          </div>
          <div class="flex justify-between text-xs text-gray-500">
            <span id="progressText">0%</span>
            <span id="progressStats">0/0 files</span>
          </div>
          
          <!-- Logs -->
          <div class="mt-4">
            <h3 class="text-sm font-semibold text-gray-700 mb-2">Process Logs</h3>
            <div id="logContainer" class="log-container p-3"></div>
          </div>
        </div>
      </div>
      
      <!-- Search Interface -->
      <div class="bg-white rounded-lg shadow-md p-6 mb-8">
        <h2 class="text-xl font-semibold mb-4">Search Embedded Repositories</h2>
        <form id="searchForm" class="space-y-4">
          <div>
            <label for="searchRepository" class="block text-sm font-medium text-gray-700 mb-1">Repository</label>
            <select id="searchRepository" name="repository" class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500">
              <option value="">Select a repository</option>
              ${repositories
                .map(
                  (repo) =>
                    `<option value="${repo.repository}">${repo.repository} (${repo.status})</option>`
                )
                .join('')}
            </select>
          </div>
          <div>
            <label for="searchQuery" class="block text-sm font-medium text-gray-700 mb-1">Search Query</label>
            <input type="text" id="searchQuery" name="query" placeholder="Enter semantic search query" 
              class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500">
          </div>
          <div>
            <label for="fileFilter" class="block text-sm font-medium text-gray-700 mb-1">File Filter (optional)</label>
            <input type="text" id="fileFilter" name="fileFilter" placeholder="e.g., src/, .ts, etc." 
              class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500">
          </div>
          <div>
            <button type="submit" class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
              <svg xmlns="http://www.w3.org/2000/svg" class="-ml-1 mr-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Search
            </button>
          </div>
        </form>
        
        <!-- Search Results -->
        <div id="searchResultsContainer" class="mt-6 hidden">
          <h3 class="text-sm font-semibold text-gray-700 mb-2">Search Results</h3>
          <div id="searchResults" class="space-y-4"></div>
        </div>
      </div>
      
      <!-- Repository Status -->
      <div class="bg-white rounded-lg shadow-md p-6">
        <h2 class="text-xl font-semibold mb-4">Embedded Repositories</h2>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Repository</th>
                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Progress</th>
                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Files</th>
                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Updated</th>
                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              ${
                repositories.length === 0
                  ? `<tr><td colspan="6" class="px-6 py-4 text-center text-sm text-gray-500">No repositories embedded yet</td></tr>`
                  : repositories
                      .map(
                        (repo) => `
                <tr>
                  <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${
                    repo.repository
                  }</td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      repo.status === 'completed'
                        ? 'bg-green-100 text-green-800'
                        : repo.status === 'in_progress'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-red-100 text-red-800'
                    }">${repo.status}</span>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div class="w-full bg-gray-200 rounded-full h-2">
                      <div class="progress-bar" style="width: ${
                        repo.progress
                      }%"></div>
                    </div>
                    <span class="text-xs">${repo.progress}%</span>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${
                    repo.processedFiles || 0
                  } / ${repo.totalFiles || 'unknown'}</td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${new Date(
                    repo.lastProcessedAt
                  ).toLocaleString()}</td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div class="flex space-x-2">
                      <button 
                        class="diff-reembed-btn px-3 py-1 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 transition"
                        data-repository="${repo.repository}">
                        Re-embed Diff
                      </button>
                      <button 
                        class="delete-repo-btn px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition"
                        data-repository="${repo.repository}">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              `
                      )
                      .join('')
              }
            </tbody>
          </table>
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

      // Embed Repository Functionality
      document.getElementById('embedForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const repository = document.getElementById('repository').value;
        const resume = document.getElementById('resume').checked;
        
        if (!repository) {
          alert('Please enter a repository in owner/repo format');
          return;
        }
        
        // Show progress container
        document.getElementById('progressContainer').classList.remove('hidden');
        const logContainer = document.getElementById('logContainer');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const progressStats = document.getElementById('progressStats');
        
        // Clear previous logs
        logContainer.innerHTML = '';
        
        // Start processing via fetch with streaming support
        try {
          const response = await fetch('/api/embed-repo', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ repository, resume }),
          });
          
          // Setup event source reader
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          
          // Process the stream
          while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
              break;
            }
            
            // Parse the streamed data
            const text = decoder.decode(value);
            const events = text.split('\\n\\n');
            
            for (const event of events) {
              if (event.startsWith('data: ')) {
                try {
                  const data = JSON.parse(event.substring(6));
                  
                  // Handle different event types
                  if (data.type === 'log' || data.type === 'error') {
                    const logEntry = document.createElement('div');
                    logEntry.className = data.type === 'error' ? 'text-red-600' : '';
                    logEntry.textContent = data.message;
                    logContainer.appendChild(logEntry);
                    logContainer.scrollTop = logContainer.scrollHeight;
                  } 
                  else if (data.type === 'progress') {
                    if (data.progress) {
                      progressBar.style.width = \`\${data.progress}%\`;
                      progressText.textContent = \`\${data.progress}%\`;
                      progressStats.textContent = \`\${data.processedFiles || 0} / \${data.totalFiles || 0} files\`;
                    }
                  }
                  else if (data.type === 'complete') {
                    progressBar.style.width = '100%';
                    progressText.textContent = '100%';
                    
                    const logEntry = document.createElement('div');
                    logEntry.className = 'text-green-600 font-bold';
                    logEntry.textContent = data.message;
                    logContainer.appendChild(logEntry);
                    
                    // Add reload button
                    const reloadBtn = document.createElement('button');
                    reloadBtn.textContent = 'Reload Page';
                    reloadBtn.className = 'mt-4 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700';
                    reloadBtn.onclick = () => window.location.reload();
                    logContainer.appendChild(reloadBtn);
                  }
                } catch (e) {
                  console.error('Error parsing event:', e, event);
                }
              }
            }
          }
        } catch (error) {
          console.error('Error:', error);
          const logEntry = document.createElement('div');
          logEntry.className = 'text-red-600';
          logEntry.textContent = \`Error: \${error.message}\`;
          logContainer.appendChild(logEntry);
        }
      });
      
      // Search Repository Functionality
      document.getElementById('searchForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const repository = document.getElementById('searchRepository').value;
        const query = document.getElementById('searchQuery').value;
        const fileFilter = document.getElementById('fileFilter').value;
        
        if (!repository || !query) {
          alert('Please select a repository and enter a search query');
          return;
        }
        
        const resultsContainer = document.getElementById('searchResultsContainer');
        const searchResults = document.getElementById('searchResults');
        
        resultsContainer.classList.remove('hidden');
        searchResults.innerHTML = '<div class="text-center py-4">Searching...</div>';
        
        try {
          const response = await fetch(\`/api/code-search?\${new URLSearchParams({
            repository,
            query,
            ...(fileFilter ? { fileFilter } : {})
          })}\`);
          
          const data = await response.json();
          
          if (response.ok) {
            if (data.results && data.results.length > 0) {
              searchResults.innerHTML = '';
              
              // Add search info
              const searchInfo = document.createElement('div');
              searchInfo.className = 'text-sm text-gray-500 mb-4';
              searchInfo.textContent = \`Found \${data.results.length} results in \${repository} for "\${query}"\`;
              searchResults.appendChild(searchInfo);
              
              // Add results
              data.results.forEach((result, index) => {
                const resultItem = document.createElement('div');
                resultItem.className = 'bg-gray-50 rounded-lg p-4';
                
                // Create header with file path, score and metadata
                const header = document.createElement('div');
                header.className = 'flex justify-between items-start mb-2';
                
                const fileInfo = document.createElement('div');
                fileInfo.innerHTML = \`
                  <h4 class="font-medium text-indigo-600">\${result.path}</h4>
                  <div class="text-xs text-gray-500">
                    \${result.type === 'file' ? 'Entire file' : \`\${result.type}: \${result.name || 'unnamed'}\`} • 
                    Lines \${result.startLine}-\${result.endLine} • 
                    \${result.language}
                  </div>
                \`;
                
                const score = document.createElement('div');
                score.className = 'text-xs font-medium px-2 py-1 bg-green-100 text-green-800 rounded-full';
                score.textContent = \`Score: \${(result.score * 100).toFixed(2)}%\`;
                
                header.appendChild(fileInfo);
                header.appendChild(score);
                
                // Create code preview
                const codePreview = document.createElement('pre');
                codePreview.className = 'bg-gray-800 text-gray-100 p-3 rounded overflow-x-auto text-sm mt-2';
                codePreview.textContent = result.content.length > 1000 
                  ? result.content.substring(0, 1000) + '...' 
                  : result.content;
                
                resultItem.appendChild(header);
                resultItem.appendChild(codePreview);
                searchResults.appendChild(resultItem);
              });
            } else {
              searchResults.innerHTML = '<div class="text-center py-4 text-gray-500">No results found</div>';
            }
          } else {
            searchResults.innerHTML = \`<div class="text-center py-4 text-red-500">Error: \${data.error || 'Unknown error'}</div>\`;
          }
        } catch (error) {
          console.error('Error:', error);
          searchResults.innerHTML = \`<div class="text-center py-4 text-red-500">Error: \${error.message}</div>\`;
        }
      });
      
      // Differential Re-embedding Functionality using event delegation
      // This works even if buttons are added to the DOM dynamically
      document.body.addEventListener('click', async (e) => {
        // Check if the clicked element or any of its parents have the diff-reembed-btn class
        const button = e.target.closest('.diff-reembed-btn');
        if (!button) return; // Not a re-embed button click
        
        const repository = button.dataset.repository;
        if (!repository) {
          console.error('No repository found in data-repository attribute');
          return;
        }
        
        console.log(\`Differential re-embed clicked for repository: \${repository}\`);
        
        if (confirm(\`Are you sure you want to update the embedding for \${repository} with changes since the last embedding?\`)) {
          // Show progress container
          document.getElementById('progressContainer').classList.remove('hidden');
          const logContainer = document.getElementById('logContainer');
          const progressBar = document.getElementById('progressBar');
          const progressText = document.getElementById('progressText');
          const progressStats = document.getElementById('progressStats');
          
          // Clear previous logs
          logContainer.innerHTML = '';
          
          // Add initial log
          const initialLog = document.createElement('div');
          initialLog.textContent = \`Starting differential re-embedding for \${repository}...\`;
          logContainer.appendChild(initialLog);
          
          try {
            const response = await fetch('/api/embed-repo', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                repository,
                resume: true,
                mode: 'diff'
              }),
            });
            
            // Setup event source reader
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            // Process the stream
            while (true) {
              const { done, value } = await reader.read();
              
              if (done) {
                break;
              }
              
              // Parse the streamed data
              const text = decoder.decode(value);
              const events = text.split('\\n\\n');
              
              for (const event of events) {
                if (event.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(event.substring(6));
                    
                    // Handle different event types
                    if (data.type === 'log' || data.type === 'error' || data.type === 'diff') {
                      const logEntry = document.createElement('div');
                      logEntry.className = data.type === 'error' 
                        ? 'text-red-600' 
                        : data.type === 'diff'
                          ? 'text-blue-600 font-semibold'
                          : '';
                      logEntry.textContent = data.message;
                      logContainer.appendChild(logEntry);
                      logContainer.scrollTop = logContainer.scrollHeight;
                    } 
                    else if (data.type === 'progress') {
                      if (data.progress) {
                        progressBar.style.width = \`\${data.progress}%\`;
                        progressText.textContent = \`\${data.progress}%\`;
                        progressStats.textContent = \`\${data.processedFiles || 0} / \${data.totalFiles || 0} files\`;
                      }
                    }
                    else if (data.type === 'complete') {
                      progressBar.style.width = '100%';
                      progressText.textContent = '100%';
                      
                      const logEntry = document.createElement('div');
                      logEntry.className = 'text-green-600 font-bold';
                      logEntry.textContent = data.message;
                      logContainer.appendChild(logEntry);
                      
                      // Add reload button
                      const reloadBtn = document.createElement('button');
                      reloadBtn.textContent = 'Reload Page';
                      reloadBtn.className = 'mt-4 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700';
                      reloadBtn.onclick = () => window.location.reload();
                      logContainer.appendChild(reloadBtn);
                    }
                  } catch (e) {
                    console.error('Error parsing event:', e, event);
                  }
                }
              }
            }
          } catch (error) {
            console.error('Error:', error);
            const logEntry = document.createElement('div');
            logEntry.className = 'text-red-600';
            logEntry.textContent = \`Error: \${error.message}\`;
            logContainer.appendChild(logEntry);
          }
        }
      });

      // Repository deletion functionality
      document.body.addEventListener('click', async (e) => {
        // Check if the clicked element or any of its parents have the delete-repo-btn class
        const button = e.target.closest('.delete-repo-btn');
        if (!button) return; // Not a delete button click
        
        const repository = button.dataset.repository;
        if (!repository) {
          console.error('No repository found in data-repository attribute');
          return;
        }
        
        console.log('Delete clicked for repository' + repository);
        
        if (confirm('Are you sure you want to COMPLETELY DELETE the repository ' + repository + ' from the embedding system? This cannot be undone.')) {
          try {
            const response = await fetch('/api/embed-repo?repository=' + encodeURIComponent(repository), {
              method: 'DELETE'
            });
            
            const result = await response.json();
            
            if (response.ok) {
              alert('Repository ' + repository + ' has been deleted. The page will now reload.');
              window.location.reload();
            } else {
              alert('Error deleting repository: ' + (result.error || 'Unknown error'));
            }
          } catch (error) {
            console.error('Error deleting repository:', error);
            alert('Error deleting repository: ' + error.message);
          }
        }
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
