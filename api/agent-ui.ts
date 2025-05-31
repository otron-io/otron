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
            <a href="/api/dashboard" class="text-lg font-bold">Otron</a>
            <div class="flex space-x-4">
              <a href="/pages/agent" class="px-3 py-2 rounded-md bg-indigo-700 font-medium">Agent Monitor</a>
              <a href="/pages/embed" class="px-3 py-2 rounded-md hover:bg-indigo-700 font-medium">Repository Embeddings</a>

              <a href="/linear-app" class="px-3 py-2 rounded-md hover:bg-indigo-700 font-medium">Install Linear App</a>
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