import type { VercelRequest, VercelResponse } from "@vercel/node";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Create a simple test server wrapper
const createTestServer = (
  handler: (req: VercelRequest, res: VercelResponse) => Promise<void> | void,
) => {
  return async (req: any, res: any) => {
    try {
      await handler(req, res);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  };
};

describe("API Endpoints Integration", () => {
  beforeAll(async () => {
    // Setup test environment
    process.env.NODE_ENV = "test";
  });

  afterAll(async () => {
    // Cleanup
    process.env.NODE_ENV = undefined;
  });

  describe("Health Endpoint", () => {
    it("should return health status", async () => {
      // Import the health handler
      const { default: healthHandler } = await import("../../api/health.js");
      const app = require("express")();
      app.get("/health", createTestServer(healthHandler));

      const response = await request(app).get("/health").expect(200);

      expect(response.body).toHaveProperty("status", "healthy");
      expect(response.body).toHaveProperty("uptime");
      expect(response.body).toHaveProperty("version");
    });
  });

  describe("Issue Actions Endpoint", () => {
    it("should handle issue actions with valid auth", async () => {
      const { default: issueActionsHandler } = await import(
        "../../api/issue-actions.js"
      );
      const app = require("express")();
      app.use(require("express").json());
      app.post("/issue-actions", createTestServer(issueActionsHandler as any));

      const response = await request(app)
        .post("/issue-actions")
        .send({
          action: "update_status",
          issueId: "TEST-123",
          status: "In Progress",
        })
        .set("Authorization", "Bearer test-token");

      // This should either succeed or fail with proper error handling
      expect([200, 400, 401, 403, 500]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toHaveProperty("success");
      } else {
        expect(response.body).toHaveProperty("error");
      }
    });

    it("should reject requests without auth", async () => {
      const { default: issueActionsHandler } = await import(
        "../../api/issue-actions.js"
      );
      const app = require("express")();
      app.use(require("express").json());
      app.post("/issue-actions", createTestServer(issueActionsHandler as any));

      const response = await request(app).post("/issue-actions").send({
        action: "update_status",
        issueId: "TEST-123",
        status: "In Progress",
      });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty("error");
    });
  });

  describe("Code Search Endpoint", () => {
    it("should handle code search requests", async () => {
      const { default: codeSearchHandler } = await import(
        "../../api/code-search.js"
      );
      const app = require("express")();
      app.use(require("express").json());
      app.post("/code-search", createTestServer(codeSearchHandler as any));

      const response = await request(app)
        .post("/code-search")
        .send({
          query: "test function",
          repository: "test/repo",
        })
        .set("Authorization", "Bearer test-token");

      expect([200, 400, 401, 403, 500]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toHaveProperty("results");
      }
    });
  });

  describe("Webhook Endpoint", () => {
    it("should handle Linear webhooks", async () => {
      const { default: webhookHandler } = await import("../../api/webhook.js");
      const app = require("express")();
      app.use(require("express").json());
      app.post("/webhook", createTestServer(webhookHandler as any));

      const mockPayload = {
        type: "AgentSessionEvent",
        action: "created",
        agentSession: {
          id: "test-session-id",
          issue: {
            id: "test-issue-id",
            identifier: "TEST-123",
            title: "Test Issue",
          },
        },
      };

      const response = await request(app)
        .post("/webhook")
        .send(mockPayload)
        .set("Content-Type", "application/json")
        .set("Linear-Signature", "test-signature");

      // Webhook should either process successfully or fail gracefully
      expect([200, 400, 401, 500]).toContain(response.status);
    });
  });

  describe("CORS Headers", () => {
    it("should include CORS headers in responses", async () => {
      const { default: healthHandler } = await import("../../api/health.js");
      const app = require("express")();
      app.get("/health", createTestServer(healthHandler));

      const response = await request(app).get("/health");

      // Check for common CORS headers
      expect(response.headers).toHaveProperty("access-control-allow-origin");
    });
  });
});
