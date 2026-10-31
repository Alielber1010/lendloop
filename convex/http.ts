import { httpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { verifyRequest } from "./lib/signing";

/**
 * Endpoints n8n calls. Every route requires a valid signature over the exact
 * body (see lib/signing.ts); anything else gets a bare 401 with no detail.
 */

const MAX_BODY_BYTES = 16 * 1024;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function signedRoute(handler: (ctx: ActionCtx, body: Record<string, unknown>) => Promise<unknown>) {
  return httpAction(async (ctx, request) => {
    const secret = process.env.N8N_TO_CONVEX_SECRET;
    if (!secret) return json(503, { error: "integration disabled" });
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: "too large" });
    const claims = await verifyRequest(request.headers.get("authorization"), raw, secret, {
      issuer: "lendloop-n8n",
      audience: "lendloop-convex",
    });
    if (!claims) return json(401, { error: "unauthorized" });
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: "invalid json" });
    }
    try {
      const result = await handler(ctx, body);
      // A well-signed request about something that doesn't exist is still a client error.
      const ok = (result as { ok?: boolean } | null)?.ok !== false;
      return json(ok ? 200 : 422, result);
    } catch (e) {
      // Validation errors from the mutation args: tell n8n it's a bad request, not a server fault,
      // so it fails fast instead of retrying.
      console.error("automation route failed", e);
      return json(400, { error: "rejected" });
    }
  });
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

const http = httpRouter();

http.route({
  path: "/automation/notification",
  method: "POST",
  handler: signedRoute((ctx, b) =>
    ctx.runMutation(internal.automation.recordNotification, {
      eventId: str(b.eventId),
      channel: str(b.channel),
      message: str(b.message),
    }),
  ),
});

http.route({
  path: "/automation/overdue-loans",
  method: "POST",
  handler: signedRoute((ctx) => ctx.runQuery(internal.automation.overdueLoans, {})),
});

http.route({
  path: "/automation/reminder",
  method: "POST",
  handler: signedRoute((ctx, b) =>
    ctx.runMutation(internal.automation.recordReminder, {
      loanId: str(b.loanId),
      reminderKey: str(b.reminderKey),
      status: b.status === "sent" ? "sent" : "failed",
      channel: str(b.channel),
      message: str(b.message),
    }),
  ),
});

http.route({
  path: "/automation/error",
  method: "POST",
  handler: signedRoute((ctx, b) =>
    ctx.runMutation(internal.automation.recordWorkflowError, {
      executionId: str(b.executionId),
      workflow: str(b.workflow),
      node: str(b.node),
      message: str(b.message),
    }),
  ),
});

export default http;
