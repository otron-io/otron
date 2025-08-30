import type { EnvContext } from "./env-context";
import { runCodex } from "./run-codex";
import { postComment } from "./post-comment";
import { addEyesReaction } from "./add-reaction";

/**
 * Handle `pull_request_review` events. We treat the review body the same way
 * as a normal comment.
 */
export async function onReview(ctx: EnvContext): Promise<void> {
  const triggerPhrase = ctx.tryGet("INPUT_TRIGGER_PHRASE");
  if (!triggerPhrase) {
    console.warn("Empty trigger phrase: skipping.");
    return;
  }

  const reviewBody = ctx.tryGet("GITHUB_EVENT_REVIEW_BODY");

  if (!reviewBody) {
    console.warn("Review body not found in environment: skipping.");
    return;
  }

  if (!reviewBody.includes(triggerPhrase)) {
    console.log(
      `Trigger phrase '${triggerPhrase}' not found: nothing to do for this review.`,
    );
    return;
  }

  const prompt = reviewBody.replace(triggerPhrase, "").trim();
  const intent = ctx.tryGet("OTRON_INTENT") ?? "auto";
  const effectivePrompt =
    prompt.length > 0
      ? prompt
      : intent === "review"
        ? "Perform a thorough PR review. Provide granular, actionable feedback with suggested code changes where helpful. Keep an executive summary concise."
        : intent === "research"
          ? "Research the request in detail and respond with a structured, thorough answer or technical plan. Do not make code changes."
          : "Act as an autonomous engineer. If this is an issue, implement the fix/feature and open a PR. If this is a PR, resolve review comments and make necessary edits to get it ready to merge. Include a concise status update.";

  await addEyesReaction(ctx);

  const lastMessage = await runCodex(effectivePrompt, ctx);
  await postComment(lastMessage, ctx);
}
