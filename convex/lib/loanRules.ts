import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";

type EventType = Doc<"automationEvents">["type"];

/** Who hears about each transition. */
const RECIPIENT: Record<EventType, "lender" | "borrower"> = {
  "loan.requested": "lender",
  "loan.cancelled": "lender",
  "loan.approved": "borrower",
  "loan.declined": "borrower",
  "loan.returned": "borrower",
};

/**
 * Record an outbox row and schedule its delivery to n8n.
 * Runs inside the same transaction as the status change, so an event exists
 * if and only if the change was committed.
 */
export async function enqueueLoanEvent(ctx: MutationCtx, loan: Doc<"loans">, type: EventType) {
  const recipientId = RECIPIENT[type] === "lender" ? loan.lenderId : loan.borrowerId;
  const eventId = crypto.randomUUID();
  await ctx.db.insert("automationEvents", {
    eventId,
    type,
    loanId: loan._id,
    recipientId,
    status: "pending",
    attempts: 0,
    nextAttemptAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.automation.deliver, { eventId });
}

/** True when [start, end] overlaps an approved loan of this tool (other than `exceptId`). */
export async function overlapsApproved(
  ctx: QueryCtx,
  toolId: Id<"tools">,
  start: string,
  end: string,
  exceptId?: Id<"loans">,
) {
  const approved = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .take(50);
  return approved.some((l) => l._id !== exceptId && l.startDate <= end && start <= l.endDate);
}

/** Decline pending requests when a listing goes away, and tell each borrower. */
export async function closeOpenRequests(ctx: MutationCtx, toolId: Id<"tools">) {
  const pending = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "requested"))
    .take(100);
  for (const loan of pending) {
    await ctx.db.patch(loan._id, { status: "declined", decidedAt: Date.now() });
    await enqueueLoanEvent(ctx, { ...loan, status: "declined" }, "loan.declined");
  }
}
