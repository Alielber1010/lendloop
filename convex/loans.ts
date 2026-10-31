import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getViewer, requireViewer } from "./lib/auth";
import { enqueueLoanEvent, overlapsApproved } from "./lib/loanRules";
import { MAX_LOAN_DAYS, assertDate, cleanText, daysBetween, todayUtc } from "./lib/validators";

export const request = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) throw new ConvexError("Listing not found");
    if (tool.ownerId === viewer._id) throw new ConvexError("You can't borrow your own tool");

    const start = assertDate(args.startDate, "Start date");
    const end = assertDate(args.endDate, "End date");
    if (start < todayUtc()) throw new ConvexError("Start date can't be in the past");
    if (end < start) throw new ConvexError("End date must be on or after the start date");
    if (daysBetween(start, end) + 1 > MAX_LOAN_DAYS) {
      throw new ConvexError(`Loans can be at most ${MAX_LOAN_DAYS} days`);
    }
    if (await overlapsApproved(ctx, tool._id, start, end)) {
      throw new ConvexError("The tool is already lent out for some of those days");
    }
    const mine = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "requested"))
      .take(100);
    if (mine.some((l) => l.borrowerId === viewer._id)) {
      throw new ConvexError("You already have a pending request for this tool");
    }

    const message = args.message ? cleanText(args.message, "Message", 280, 0) : undefined;
    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      toolName: tool.name,
      lenderId: tool.ownerId,
      borrowerId: viewer._id,
      startDate: start,
      endDate: end,
      message: message || undefined,
      status: "requested",
    });
    await enqueueLoanEvent(ctx, (await ctx.db.get(loanId))!, "loan.requested");
    return loanId;
  },
});

/** Load a loan and check the viewer plays `role` in it. Admins don't bypass this: they moderate, not lend. */
async function loanAs(ctx: MutationCtx, loanId: Id<"loans">, role: "lender" | "borrower") {
  const viewer = await requireViewer(ctx);
  const loan = await ctx.db.get(loanId);
  const party = role === "lender" ? loan?.lenderId : loan?.borrowerId;
  if (!loan || party !== viewer._id) throw new ConvexError("Request not found");
  return loan;
}

function expectStatus(loan: Doc<"loans">, status: Doc<"loans">["status"]) {
  if (loan.status !== status) throw new ConvexError(`This request is already ${loan.status}`);
}

export const approve = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await loanAs(ctx, loanId, "lender");
    expectStatus(loan, "requested");
    if (loan.endDate < todayUtc()) throw new ConvexError("These dates have already passed");
    if (await overlapsApproved(ctx, loan.toolId, loan.startDate, loan.endDate, loan._id)) {
      throw new ConvexError("You've already approved another loan for those days");
    }
    await ctx.db.patch(loan._id, { status: "approved", decidedAt: Date.now() });
    await enqueueLoanEvent(ctx, { ...loan, status: "approved" }, "loan.approved");
  },
});

export const decline = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await loanAs(ctx, loanId, "lender");
    expectStatus(loan, "requested");
    await ctx.db.patch(loan._id, { status: "declined", decidedAt: Date.now() });
    await enqueueLoanEvent(ctx, { ...loan, status: "declined" }, "loan.declined");
  },
});

export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await loanAs(ctx, loanId, "borrower");
    expectStatus(loan, "requested");
    await ctx.db.patch(loan._id, { status: "cancelled", decidedAt: Date.now() });
    await enqueueLoanEvent(ctx, { ...loan, status: "cancelled" }, "loan.cancelled");
  },
});

/** Only the lender confirms a return: they're the one who has the tool back. */
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await loanAs(ctx, loanId, "lender");
    expectStatus(loan, "approved");
    await ctx.db.patch(loan._id, { status: "returned", returnedAt: Date.now() });
    await enqueueLoanEvent(ctx, { ...loan, status: "returned" }, "loan.returned");
  },
});

export type LoanPhase = "pending" | "upcoming" | "active" | "overdue" | "closed";

function phaseOf(loan: Doc<"loans">, today: string): LoanPhase {
  if (loan.status === "requested") return "pending";
  if (loan.status !== "approved") return "closed";
  if (loan.endDate < today) return "overdue";
  return loan.startDate <= today ? "active" : "upcoming";
}

export async function toLoanView(ctx: QueryCtx, loan: Doc<"loans">) {
  const [lender, borrower, activity] = await Promise.all([
    ctx.db.get(loan.lenderId),
    ctx.db.get(loan.borrowerId),
    ctx.db
      .query("loanActivity")
      .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
      .order("desc")
      .take(4),
  ]);
  return {
    ...loan,
    phase: phaseOf(loan, todayUtc()),
    lender: { _id: loan.lenderId, name: lender?.name ?? "Neighbour", trusted: lender?.trustedLender ?? false },
    borrower: { _id: loan.borrowerId, name: borrower?.name ?? "Neighbour" },
    activity: activity.map((a) => ({ _id: a._id, kind: a.kind, summary: a.summary, at: a._creationTime })),
  };
}

/** Loans where the viewer is the borrower. */
export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", viewer._id))
      .order("desc")
      .take(100);
    return Promise.all(loans.map((l) => toLoanView(ctx, l)));
  },
});

/** Loans of the viewer's own tools. */
export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_lender", (q) => q.eq("lenderId", viewer._id))
      .order("desc")
      .take(100);
    return Promise.all(loans.map((l) => toLoanView(ctx, l)));
  },
});
