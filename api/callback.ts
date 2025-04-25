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

  const code = req.query.code as string;

  if (!code) {
    return res.status(400).json({ error: "Missing code parameter" });
  }

  try {
    const accessToken = await linearService.getAccessToken(code);
    console.log("Access token:", accessToken);
    return res.status(200).json({
      success: true,
      message: "Successfully authenticated!",
    });
  } catch (error) {
    console.error("OAuth error:", error);
    return res.status(500).json({ error: "Authentication failed" });
  }
}
