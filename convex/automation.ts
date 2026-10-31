import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { signRequest } from "./lib/signing";
import { cleanText, daysBetween, todayUtc } from "./lib/validators";

/**
 * Convex <-> n8n integration.
 *
 * Outbound: `deliver` posts one outbox event to the n8n webhook, retrying with
 * exponential backoff (30s, 2m, 8m, 32m) and giving up visibly after 5 tries.
 * Inbound: the record* mutations are called by the signed HTTP routes in http.ts.
 * Each one is idempotent on a key n8n sends, so a retried write-back is a no-op.
 */

const MAX_ATTEMPTS = 5;
const ISSUER = "lendloop-convex";
const N8N_AUDIENCE = "lendloop-n8n";

/** The minimum n8n needs to word a message: no emails, no descriptions, no other loans. */
export const eventPayload = internalQuery({
  args: { eventId: v.string() },
  handler: async (ctx, { eventId }) => {
    const event = await eventById(ctx, eventId);
    if (!event || event.status !== "pending") return null;
    const loan = await ctx.db.get(event.loanId);
    if (!loan) return null;
    const recipientIsLender = event.recipientId === loan.lenderId;
    const [recipient, counterpart] = await Promise.all([
      ctx.db.get(event.recipientId),
      ctx.db.get(recipientIsLender ? loan.borrowerId : loan.lenderId),
    ]);
    return {
      eventId: event.eventId,
      type: event.type,
      occurredAt: new Date(event._creationTime).toISOString(),
      loan: { id: loan._id, status: loan.status, startDate: loan.startDate, endDate: loan.endDate },
      tool: { name: loan.toolName },
      recipient: {
        ref: event.recipientId,
        name: recipient?.name ?? "Neighbour",
        role: recipientIsLender ? "lender" : "borrower",
      },
      counterpart: { name: counterpart?.name ?? "A neighbour" },
    };
  },
});

export const deliver = internalAction({
  args: { eventId: v.string() },
  handler: async (ctx, { eventId }) => {
    const payload = await ctx.runQuery(internal.automation.eventPayload, { eventId });
    if (!payload) return;
    const url = process.env.N8N_LOAN_EVENT_WEBHOOK_URL;
    const secret = process.env.CONVEX_TO_N8N_SECRET;
    if (!url || !secret) {
      await ctx.runMutation(internal.automation.recordAttempt, { eventId, outcome: "skipped" });
      return;
    }
    const body = JSON.stringify(payload);
    let error: string | undefined;
    try {
      const token = await signRequest(body, secret, { issuer: ISSUER, audience: N8N_AUDIENCE, jti: eventId });
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      // Only the workflow's final "Respond 200" node answers {"ok":true}. n8n replies with an
      // empty 200 when a run fails midway, so a bare 2xx is not proof of delivery.
      const answer = await res.json().catch(() => null);
      if (!res.ok) error = `n8n answered HTTP ${res.status}`;
      else if (answer?.ok !== true) error = "n8n run did not complete";
    } catch (e) {
      error = e instanceof Error ? e.message : "network error";
    }
    await ctx.runMutation(internal.automation.recordAttempt, {
      eventId,
      outcome: error ? "error" : "delivered",
      error,
    });
  },
});

export const recordAttempt = internalMutation({
  args: {
    eventId: v.string(),
    outcome: v.union(v.literal("delivered"), v.literal("error"), v.literal("skipped")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, outcome, error }) => {
    const event = await eventById(ctx, eventId);
    if (!event || event.status !== "pending") return;
    const attempts = event.attempts + 1;
    if (outcome === "delivered") {
      await ctx.db.patch(event._id, { status: "delivered", attempts, deliveredAt: Date.now(), nextAttemptAt: undefined });
      return;
    }
    if (outcome === "skipped") {
      await ctx.db.patch(event._id, { status: "skipped", attempts, lastError: "n8n is not configured" });
      return;
    }
    const lastError = (error ?? "unknown error").slice(0, 300);
    if (attempts >= MAX_ATTEMPTS) {
      await ctx.db.patch(event._id, { status: "failed", attempts, lastError, nextAttemptAt: undefined });
      await addActivity(ctx, event.loanId, "delivery_failed", `Notification failed after ${attempts} tries`, `failed:${eventId}`);
      return;
    }
    const delay = 30_000 * 4 ** (attempts - 1);
    await ctx.db.patch(event._id, { attempts, lastError, nextAttemptAt: Date.now() + delay });
    await ctx.scheduler.runAfter(delay, internal.automation.deliver, { eventId });
  },
});

/** Cron safety net: re-queue events whose scheduled delivery never ran (e.g. a crashed action). */
export const sweepStuck = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stuck = await ctx.db
      .query("automationEvents")
      .withIndex("by_status_next", (q) => q.eq("status", "pending").lt("nextAttemptAt", Date.now() - 10 * 60_000))
      .take(50);
    for (const event of stuck) {
      await ctx.db.patch(event._id, { nextAttemptAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.automation.deliver, { eventId: event.eventId });
    }
  },
});

// ---------------------------------------------------------------- write-backs

/** n8n confirms it notified the recipient. The recipient comes from our own event row, never from n8n. */
export const recordNotification = internalMutation({
  args: { eventId: v.string(), channel: v.string(), message: v.string() },
  handler: async (ctx, { eventId, channel, message }) => {
    const event = await eventById(ctx, eventId);
    if (!event) return { ok: false as const, error: "unknown event" };
    const key = `notify:${eventId}`;
    if (await activityByKey(ctx, key)) return { ok: true as const, duplicate: true };

    const loan = await ctx.db.get(event.loanId);
    const role = loan && event.recipientId === loan.lenderId ? "Lender" : "Borrower";
    await ctx.db.insert("notifications", {
      userId: event.recipientId,
      loanId: event.loanId,
      message: cleanText(message, "message", 280),
      key,
      read: false,
    });
    await addActivity(ctx, event.loanId, "notification", `${role} notified (${cleanText(channel, "channel", 20)})`, key);
    if (event.status === "pending" || event.status === "failed") {
      await ctx.db.patch(event._id, { status: "delivered", deliveredAt: Date.now(), nextAttemptAt: undefined });
    }
    return { ok: true as const, duplicate: false };
  },
});

/** Approved, unreturned loans past their end date that haven't had today's reminder yet. */
export const overdueLoans = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayUtc();
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_endDate", (q) => q.eq("status", "approved").lt("endDate", today))
      .take(200);
    const due = [];
    for (const loan of loans) {
      const reminderKey = `reminder:${loan._id}:${today}`;
      if (await activityByKey(ctx, reminderKey)) continue;
      const borrower = await ctx.db.get(loan.borrowerId);
      due.push({
        loanId: loan._id,
        reminderKey,
        borrowerRef: loan.borrowerId,
        borrowerName: borrower?.name ?? "Neighbour",
        toolName: loan.toolName,
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
      });
    }
    return { asOf: today, loans: due };
  },
});

export const recordReminder = internalMutation({
  args: {
    loanId: v.string(),
    reminderKey: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    channel: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const loanId = ctx.db.normalizeId("loans", args.loanId);
    const loan = loanId ? await ctx.db.get(loanId) : null;
    if (!loan) return { ok: false as const, error: "unknown loan" };
    // The key must be for this loan and for today or yesterday (a run that crossed midnight).
    const today = todayUtc();
    const yesterday = todayUtc(Date.now() - 86_400_000);
    if (![today, yesterday].some((d) => args.reminderKey === `reminder:${loan._id}:${d}`)) {
      return { ok: false as const, error: "bad reminder key" };
    }
    const key = args.status === "sent" ? args.reminderKey : `${args.reminderKey}:failed`;
    if (await activityByKey(ctx, key)) return { ok: true as const, duplicate: true };

    if (args.status === "sent") {
      await ctx.db.insert("notifications", {
        userId: loan.borrowerId,
        loanId: loan._id,
        message: cleanText(args.message, "message", 280),
        key,
        read: false,
      });
      await addActivity(ctx, loan._id, "reminder", `Overdue reminder sent (${cleanText(args.channel, "channel", 20)})`, key);
    } else {
      await addActivity(ctx, loan._id, "reminder_failed", "Overdue reminder failed", key);
    }
    return { ok: true as const, duplicate: false };
  },
});

export const recordWorkflowError = internalMutation({
  args: { executionId: v.string(), workflow: v.string(), node: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    const executionId = args.executionId.slice(0, 64);
    const existing = await ctx.db
      .query("automationErrors")
      .withIndex("by_executionId", (q) => q.eq("executionId", executionId))
      .first();
    if (existing) return { ok: true as const, duplicate: true };
    await ctx.db.insert("automationErrors", {
      executionId,
      workflow: args.workflow.slice(0, 80),
      node: args.node.slice(0, 80),
      message: args.message.slice(0, 500),
    });
    return { ok: true as const, duplicate: false };
  },
});

// ---------------------------------------------------------------- helpers

async function eventById(ctx: QueryCtx, eventId: string) {
  return await ctx.db
    .query("automationEvents")
    .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
    .unique();
}

async function activityByKey(ctx: QueryCtx, key: string) {
  return await ctx.db
    .query("loanActivity")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
}

async function addActivity(
  ctx: MutationCtx,
  loanId: Doc<"loans">["_id"],
  kind: Doc<"loanActivity">["kind"],
  summary: string,
  key: string,
) {
  await ctx.db.insert("loanActivity", { loanId, kind, summary, key });
}
