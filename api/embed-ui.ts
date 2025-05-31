import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { env } from '../lib/env.js';
import { withPasswordProtection } from '../lib/auth.js';

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
    <!-- Navigation Bar -->
    <nav class="bg-indigo-600 text-white shadow-md">
      <div class="max-w-6xl mx-auto px-4 py-3">
        <div class="flex justify-between items-center">
          <div class="flex items-center space-x-8">
            <a href="/pages/dashboard" class="text-lg font-bold">Otron</a>
            <div class="flex space-x-4">
              <a href="/pages/agent" class="px-3 py-2 rounded-md hover:bg-indigo-700 font-medium">Agent Monitor</a>
              <a href="/pages/embed" class="px-3 py-2 rounded-md bg-indigo-700 font-medium">Repository Embeddings</a>
            </div>
            <div class="flex space-x-4">
              <a href="/pages/agent" class="px-3 py-2 rounded-md hover:bg-indigo-700 font-medium">Agent Monitor</a>
              <a href="/pages/embed" class="px-3 py-2 rounded-md bg-indigo-700 font-medium">Repository Embeddings</a>
            </div>
          </div>
        </div>
      </div>
    </nav>

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