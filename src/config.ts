import dotenv from "dotenv";

dotenv.config();

export const config = {
  linearClientId: process.env.LINEAR_CLIENT_ID,
  linearClientSecret: process.env.LINEAR_CLIENT_SECRET || "",
  webhookSigningSecret: process.env.WEBHOOK_SIGNING_SECRET,
  redirectUri: process.env.REDIRECT_URI,
  webhookUrl: process.env.WEBHOOK_URL,
};
