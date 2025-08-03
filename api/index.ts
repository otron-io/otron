import type { VercelRequest, VercelResponse } from "@vercel/node";
import { env } from "../lib/core/env.js";
import { LinearService } from "../lib/linear/linear-service.js";

// Initialize Linear service
const linearService = new LinearService(
  env.LINEAR_CLIENT_ID,
  env.LINEAR_CLIENT_SECRET,
  env.REDIRECT_URI,
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authUrl = linearService.getAuthUrl();
    return res.redirect(307, authUrl);
  } catch (error) {
    console.error("Authentication error:", error);
    return res
      .status(500)
      .send(
        "Something went wrong with Linear authentication. Please try again.",
      );
  }
}
