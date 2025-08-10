import type { SlackEvent } from "@slack/web-api";
import {
  assistantThreadMessage,
  handleNewAssistantMessage,
} from "../lib/slack/handle-messages.js";
import { waitUntil } from "@vercel/functions";
import { handleNewAppMention } from "../lib/slack/handle-app-mention.js";
import {
  verifyRequest,
  getBotId,
  getUserInfo,
} from "../lib/slack/slack-utils.js";
import {
  handleSlackInteractive,
  type SlackInteractivePayload,
} from "../lib/slack/handle-interactive.js";
import { Redis } from "@upstash/redis";
import { env } from "../lib/env.js";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const rawBody = await request.text();

  // Basic request logging (non-fatal)
  try {
    const sig = request.headers.get("x-slack-signature");
    const ts = request.headers.get("x-slack-request-timestamp");
    console.log("[events] Incoming request", {
      method: "POST",
      contentType,
      bodyLength: rawBody.length,
      hasSignature: Boolean(sig),
      hasTimestamp: Boolean(ts),
    });
  } catch {}

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(rawBody);
    const payloadString = params.get("payload");
    if (payloadString) {
      try {
        const payload = JSON.parse(payloadString);
        if (
          payload.type &&
          [
            "block_actions",
            "shortcut",
            "message_action",
            "view_submission",
            "view_closed",
          ].includes(payload.type)
        ) {
          console.log("Interactive payload", payload);

          return handleInteractivePayload(request, rawBody, payload);
        }
      } catch {
        return new Response("Invalid payload format", { status: 400 });
      }
    }
    return new Response("Invalid request format", { status: 400 });
  }

  if (contentType.includes("application/json")) {
    console.log("Slack events", rawBody);

    return handleSlackEvents(request, rawBody);
  }

  return new Response("Unsupported content type", { status: 400 });
}

async function handleInteractivePayload(
  request: Request,
  rawBody: string,
  payload: SlackInteractivePayload
) {
  try {
    await verifyRequest({ requestType: "interactive", request, rawBody });
    const botUserId = await getBotId();
    waitUntil(handleSlackInteractive(payload, botUserId));
    return new Response("", { status: 200 });
  } catch (error) {
    console.error("Error handling interactive payload:", error);
    return new Response("Error handling interactive payload", { status: 500 });
  }
}

async function handleSlackEvents(request: Request, rawBody: string) {
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const requestType = payload.type as "url_verification" | "event_callback";

  // See https://api.slack.com/events/url_verification
  if (requestType === "url_verification") {
    // In marvin we do not verify signature for url_verification to avoid double-read race; but it's fine either way.
    return new Response(payload.challenge, { status: 200 });
  }

  // Verify all other event callbacks
  if (requestType === "event_callback") {
    try {
      await verifyRequest({ requestType: "event_callback", request, rawBody });
    } catch (error) {
      console.error("Event verification failed:", error);
      return new Response("Verification failed", { status: 401 });
    }

    // Dedupe retries and concurrent deliveries using Slack event_id
    const retryNum = request.headers.get("x-slack-retry-num");
    const retryReason = request.headers.get("x-slack-retry-reason");
    const eventId = (payload as any)?.event_id as string | undefined;
    try {
      const redis = new Redis({
        url: env.KV_REST_API_URL,
        token: env.KV_REST_API_TOKEN,
      });
      if (eventId) {
        const ok = await (redis as any).set(
          `slack:event:${eventId}` as any,
          "1",
          { nx: true, ex: 60 * 10 } as any
        );
        if (!ok) {
          // Key already exists → always skip processing duplicates/retries.
          console.log("[events] Duplicate/retry event detected; skipping", {
            eventId,
            retryNum,
            retryReason,
          });
          return new Response("Success!", { status: 200 });
        }
      }
    } catch (e) {
      console.warn("[events] Dedupe check failed", e);
    }

    const botUserId = await getBotId();
    const event = payload.event as SlackEvent;

    // Global guard: ignore any events originating from bots (including our own)
    const isFromBot = Boolean(
      (event as any)?.bot_id ||
        (event as any)?.bot_profile ||
        (event as any)?.subtype === "bot_message" ||
        (event as any)?.user === botUserId
    );
    if (isFromBot) {
      return new Response("Success!", { status: 200 });
    }

    // Secondary check via users.info: some bot posts may not include bot_id
    if ((event as any)?.user) {
      try {
        const u = await getUserInfo((event as any).user);
        if ((u as any)?.is_bot) {
          return new Response("Success!", { status: 200 });
        }
      } catch {}
    }

    if (event.type === "app_mention") {
      waitUntil(handleNewAppMention(event as any, botUserId));
      return new Response("Success!", { status: 200 });
    }

    if ((event as any).type === "assistant_thread_started") {
      waitUntil(assistantThreadMessage(event as any));
      return new Response("Success!", { status: 200 });
    }

    // Handle new user DM messages: channel IDs for IMs start with 'D'
    if (
      (event as any).type === "message" &&
      !(event as any).subtype &&
      typeof (event as any).channel === "string" &&
      (event as any).channel.startsWith("D") &&
      !(event as any).bot_id &&
      !(event as any).bot_profile &&
      (event as any).user &&
      (event as any).user !== botUserId
    ) {
      try {
        await handleNewAssistantMessage(event as any, botUserId);
      } catch (e) {
        console.error("[events] DM handler error", e);
        return new Response("Handler error", { status: 500 });
      }
      return new Response("Success!", { status: 200 });
    }

    return new Response("Success!", { status: 200 });
  }

  // Unknown request type
  return new Response("Unknown request type", { status: 400 });
}
