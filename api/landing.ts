import { VercelRequest, VercelResponse } from "vercel";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const html = `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Otron – Multiplatform AI Agent</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        .hero-bg {
          background-image: linear-gradient(to right top, #6366f1, #8b5cf6);
        }
        .feature-card {
          transition: transform 0.15s, box-shadow 0.15s;
        }
        .feature-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 8px 20px -4px rgba(0, 0, 0, 0.1);
        }
      </style>
    </head>
    <body class="bg-gray-50 text-gray-900">
      <!-- Navigation -->
      <nav class="bg-white shadow-sm py-4 sticky top-0 z-50">
        <div class="max-w-7xl mx-auto px-4 flex justify-between items-center">
          <a href="/api/landing" class="text-xl font-bold text-indigo-600">Otron</a>
          <div class="space-x-6 hidden md:block">
            <a href="/api/dashboard" class="text-sm font-medium text-gray-700 hover:text-indigo-600">Dashboard</a>
            <a href="/pages/agent" class="text-sm font-medium text-gray-700 hover:text-indigo-600">Agent Monitor</a>
            <a href="/pages/embed" class="text-sm font-medium text-gray-700 hover:text-indigo-600">Repository Embeddings</a>
            <a href="https://github.com/otron-io/otron" target="_blank" class="text-sm font-medium text-gray-700 hover:text-indigo-600">GitHub</a>
          </div>
        </div>
      </nav>

      <!-- Hero -->
      <section class="hero-bg text-white py-20">
        <div class="max-w-4xl mx-auto text-center px-4">
          <h1 class="text-4xl md:text-6xl font-extrabold mb-6">An AI Agent that works <span class="underline decoration-amber-300">everywhere</span></h1>
          <p class="text-lg md:text-2xl opacity-90 mb-8">Slack · Linear · GitHub – Otron orchestrates your workflows, writes code, and keeps your team in sync.</p>
          <a href="https://github.com/otron-io/otron" target="_blank" class="inline-block bg-white text-indigo-700 font-semibold px-8 py-3 rounded-md shadow hover:bg-gray-100 transition">View on GitHub</a>
        </div>
      </section>

      <!-- Features -->
      <section class="py-16">
        <div class="max-w-6xl mx-auto px-4">
          <h2 class="text-3xl font-bold text-center mb-12">Why Otron?</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <div class="feature-card bg-white rounded-xl p-6">
              <div class="flex items-center justify-center h-12 w-12 rounded-md bg-indigo-600 text-white mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-3-3v6m8-6a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 class="text-xl font-semibold mb-2">Instant Context Switching</h3>
              <p class="text-gray-600">Seamlessly jump between Slack conversations, Linear issues, and GitHub PRs without losing context.</p>
            </div>
            <div class="feature-card bg-white rounded-xl p-6">
              <div class="flex items-center justify-center h-12 w-12 rounded-md bg-indigo-600 text-white mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h4l2 2h6l2-2h4a1 1 0 011 1v15a2 2 0 01-2 2H5a2 2 0 01-2-2V4z" />
                </svg>
              </div>
              <h3 class="text-xl font-semibold mb-2">Repository Awareness</h3>
              <p class="text-gray-600">Semantic code embeddings allow Otron to answer questions and generate PRs directly from your codebase.</p>
            </div>
            <div class="feature-card bg-white rounded-xl p-6">
              <div class="flex items-center justify-center h-12 w-12 rounded-md bg-indigo-600 text-white mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1 4v-4m8 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 class="text-xl font-semibold mb-2">Customizable Workflows</h3>
              <p class="text-gray-600">Define tool usage policies, branch naming conventions, and deployment checks that match your team’s needs.</p>
            </div>
            <div class="feature-card bg-white rounded-xl p-6">
              <div class="flex items-center justify-center h-12 w-12 rounded-md bg-indigo-600 text-white mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </div>
              <h3 class="text-xl font-semibold mb-2">Secure by Design</h3>
              <p class="text-gray-600">Tokens are stored safely, and internal API routing ensures your data never leaves your cloud.</p>
            </div>
            <div class="feature-card bg-white rounded-xl p-6">
              <div class="flex items-center justify-center h-12 w-12 rounded-md bg-indigo-600 text-white mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 17a4 4 0 100-8 4 4 0 000 8zm-7 0a4 4 0 100-8 4 4 0 000 8zm14 0a4 4 0 100-8 4 4 0 000 8z" />
                </svg>
              </div>
              <h3 class="text-xl font-semibold mb-2">Open-Source Community</h3>
              <p class="text-gray-600">Join the discussion, contribute new tools, and make Otron smarter for everyone.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Call to action -->
      <section class="py-20 bg-indigo-600">
        <div class="max-w-4xl mx-auto text-center text-white px-4">
          <h2 class="text-3xl font-bold mb-4">Ready to level-up your workflow?</h2>
          <p class="text-lg mb-8 opacity-90">Deploy Otron to Vercel in minutes and let the agent take over the busywork.</p>
          <a href="https://github.com/otron-io/otron#deploy" target="_blank" class="inline-block bg-white text-indigo-700 font-semibold px-8 py-3 rounded-md shadow hover:bg-gray-100 transition">Deploy with one click</a>
        </div>
      </section>

      <footer class="py-6 text-center text-gray-500 text-sm">
        © ${new Date().getFullYear()} Otron. Built with ❤️ by the community.
      </footer>
    </body>
  </html>
  `;

  res.setHeader("Content-Type", "text/html");
  return res.status(200).send(html);
}
