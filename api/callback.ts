import { Redis } from "@upstash/redis";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { env } from "../src/env.js";
import { LinearService } from "../src/linear.js";

// Initialize Linear service
const linearService = new LinearService(
  env.LINEAR_CLIENT_ID,
  env.LINEAR_CLIENT_SECRET,
  env.REDIRECT_URI,
);

// Initialize Upstash Redis
const redis = new Redis({
  url: env.KV_REST_API_URL,
  token: env.KV_REST_API_TOKEN,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const code = req.query.code as string;
  if (!code) {
    return res.status(400).json({ error: "Missing code parameter" });
  }

  try {
    const { accessToken, appUserId, organizationId } =
      await linearService.getAccessToken(code);

    // Store tokens
    if (organizationId) {
      await redis.set(`linear:${organizationId}:accessToken`, accessToken);
      await redis.set(`linear:${organizationId}:appUserId`, appUserId);
    }

    await redis.set("linearAccessToken", accessToken);
    await redis.set("linearAppUserId", appUserId);

    // Success page with Tailwind
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Connected to Linear</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-50 flex items-center justify-center h-screen">
          <div class="bg-white rounded-lg shadow-lg p-8 max-w-md mx-auto text-center">
            <div class="inline-flex items-center justify-center w-16 h-16 bg-indigo-600 rounded-full mb-6">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 class="text-2xl font-bold text-gray-900 mb-3">Linear Agent Connected</h1>
            <p class="text-gray-600 mb-6">Your agent is now ready to use! Mention <span class="font-semibold">@Agent</span> in any Linear issue to get help with analysis, refinement, or answer questions about your tickets.</p>
            <a href="https://linear.app" class="inline-block bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-6 rounded-md transition duration-200">Return to Linear</a>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("OAuth error:", error);

    // Error page with Tailwind
    return res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Connection failed</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-50 flex items-center justify-center h-screen">
          <div class="bg-white rounded-lg shadow-lg p-8 max-w-md mx-auto text-center">
            <div class="inline-flex items-center justify-center w-16 h-16 bg-red-500 rounded-full mb-6">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 class="text-2xl font-bold text-gray-900 mb-3">Connection Failed</h1>
            <p class="text-gray-600 mb-6">We couldn't connect your Linear Agent. Please try again or contact support if the problem persists.</p>
            <a href="https://linear.fingertip.com" class="inline-block bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-6 rounded-md transition duration-200">Try Again</a>
          </div>
        </body>
      </html>
    `);
  }
}
