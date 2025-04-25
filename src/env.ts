import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    LINEAR_CLIENT_ID: z.string().min(1),
    LINEAR_CLIENT_SECRET: z.string().min(1),
    WEBHOOK_SIGNING_SECRET: z.string().min(1),
    REDIRECT_URI: z.string().url(),
    WEBHOOK_URL: z.string().url(),
    EDGE_CONFIG: z.string().url(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
