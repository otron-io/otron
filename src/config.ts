import dotenv from "dotenv";

dotenv.config();

export const config = {
  linearClientId:
    process.env.LINEAR_CLIENT_ID || "b0903b7ef7c9e7b3d590422daabb3fdf",
  linearClientSecret: process.env.LINEAR_CLIENT_SECRET || "",
  webhookSigningSecret:
    process.env.WEBHOOK_SIGNING_SECRET ||
    "lin_wh_qRZcaJAqidilYuBmafcg5Th4NOPZmUVEX7aMOc7YQHlO",
  redirectUri:
    process.env.REDIRECT_URI || "https://linear.fingertip.com/callback",
  webhookUrl: process.env.WEBHOOK_URL || "https://linear.fingertip.com/webhook",
};
