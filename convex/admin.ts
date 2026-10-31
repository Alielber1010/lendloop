import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { closeOpenRequests } from "./lib/loanRules";
import { toLoanView } from "./loans";

export const allLoans = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").order("desc").take(200);
    return Promise.all(loans.map((l) => toLoanView(ctx, l)));
  },
});

export const users = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").take(500);
    return Promise.all(
      users.map(async (u) => ({
        _id: u._id,
        name: u.name,
        role: u.role,
        trustedLender: u.trustedLender,
        listings: (
          await ctx.db
            .query("tools")
            .withIndex("by_owner", (q) => q.eq("ownerId", u._id))
            .take(50)
        ).length,
      })),
    );
  },
});

/** Moderation: an admin may remove any listing. Approved loans keep running on their snapshot. */
export const removeTool = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    await requireAdmin(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new ConvexError("Listing not found");
    await closeOpenRequests(ctx, tool._id);
    await ctx.db.delete(tool._id);
  },
});

export const setTrusted = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("User not found");
    await ctx.db.patch(user._id, { trustedLender: trusted });
  },
});

/** Health of the n8n integration: undelivered events and failed workflow runs. */
export const automationHealth = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [failed, pending, errors] = await Promise.all([
      ctx.db
        .query("automationEvents")
        .withIndex("by_status_next", (q) => q.eq("status", "failed"))
        .order("desc")
        .take(20),
      ctx.db
        .query("automationEvents")
        .withIndex("by_status_next", (q) => q.eq("status", "pending"))
        .take(50),
      ctx.db.query("automationErrors").order("desc").take(20),
    ]);
    return {
      pendingCount: pending.length,
      failedEvents: failed.map((e) => ({
        _id: e._id,
        type: e.type,
        attempts: e.attempts,
        lastError: e.lastError,
        at: e._creationTime,
      })),
      workflowErrors: errors.map((e) => ({
        _id: e._id,
        workflow: e.workflow,
        node: e.node,
        message: e.message,
        executionId: e.executionId,
        at: e._creationTime,
      })),
    };
  },
});
