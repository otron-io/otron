import { VercelRequest, VercelResponse } from "@vercel/node";
import { env } from "../src/env.js";
import { LinearService } from "../src/linear.js";

// Initialize Linear service
const linearService = new LinearService(
  env.LINEAR_CLIENT_ID,
  env.LINEAR_CLIENT_SECRET,
  env.REDIRECT_URI,
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only handle GET requests
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const authUrl = linearService.getAuthUrl();
  return res.status(200).json({ authUrl });
}
