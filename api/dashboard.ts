import type { VercelRequest, VercelResponse } from '@vercel/node';
import { env } from '../src/env.js';
import { withPasswordProtection } from '../src/utils/auth.js';

/**
 * Dashboard with links to all available UIs
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
    <title>Otron Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      .card-hover {
        transition: transform 0.2s, box-shadow 0.2s;
      }
      .card-hover:hover {
        transform: translateY(-5px);
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
      }
    </style>
  </head>
  <body class="bg-gray-50 text-gray-900">
    <nav class="bg-indigo-600 text-white shadow-md">
      <div class="max-w-6xl mx-auto px-4 py-3">
        <div class="flex justify-between items-center">
          <a href="/pages/dashboard" class="text-xl font-bold">Otron Dashboard</a>
        </div>
      </div>
    </nav>

    <div class="max-w-6xl mx-auto p-4 py-12">
      <h1 class="text-4xl font-bold text-gray-900 mb-8 text-center">Otron Agent Dashboard</h1>
      
      <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mt-12">
        <!-- Agent Monitor Card -->
        <a href="/pages/agent" class="block">
          <div class="bg-white rounded-xl shadow-md p-6 card-hover">
            <div class="flex items-center justify-center h-12 w-12 rounded-md bg-indigo-600 text-white mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h2 class="text-2xl font-semibold text-gray-900 mb-2">Agent Monitor</h2>
            <p class="text-gray-600">View real-time agent activity, active issues, and tool usage statistics.</p>
          </div>
        </a>
        
        <!-- Repository Embeddings Card -->
        <a href="/pages/embed" class="block">
          <div class="bg-white rounded-xl shadow-md p-6 card-hover">
            <div class="flex items-center justify-center h-12 w-12 rounded-md bg-indigo-600 text-white mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 class="text-2xl font-semibold text-gray-900 mb-2">Repository Embeddings</h2>
            <p class="text-gray-600">Manage and search code repository embeddings for AI analysis.</p>
          </div>
        </a>
      </div>

      <div class="mt-16 bg-white rounded-lg shadow-md p-6">
        <h2 class="text-xl font-semibold mb-4">System Information</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h3 class="text-lg font-medium text-gray-700">Otron Agent</h3>
            <ul class="mt-2 space-y-1 text-gray-600">
              <li>Version: ${process.env.npm_package_version || '1.0.0'}</li>
              <li>Environment: ${process.env.NODE_ENV || 'development'}</li>
            </ul>
          </div>
          <div>
            <h3 class="text-lg font-medium text-gray-700">Integrations</h3>
            <ul class="mt-2 space-y-1 text-gray-600">
              <li>Linear: ${
                env.LINEAR_CLIENT_ID ? '✓ Connected' : '✗ Not configured'
              }</li>
              <li>GitHub: ${
                env.GITHUB_APP_ID ? '✓ Connected' : '✗ Not configured'
              }</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </body>
  </html>
  `;

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
}

// Export the handler with password protection
export default withPasswordProtection(handler);
