import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getViewer, upsertViewer } from "./lib/auth";

/** Called by the client right after sign-in; creates or refreshes the profile from the verified token. */
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const viewer = await upsertViewer(ctx);
    return { _id: viewer._id, role: viewer.role };
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return null;
    return { _id: viewer._id, name: viewer.name, role: viewer.role, trustedLender: viewer.trustedLender };
  },
});

/**
 * Promote or demote a user. Internal: only callable from the Convex dashboard or CLI
 * (`npx convex run users:setRole '{"clerkId":"user_...","role":"admin"}'`), never from a browser.
 */
export const setRole = internalMutation({
  args: { clerkId: v.string(), role: v.union(v.literal("admin"), v.literal("user")) },
  handler: async (ctx, { clerkId, role }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
      .unique();
    if (!user) throw new Error(`No user with clerkId ${clerkId}; they must sign in once first`);
    await ctx.db.patch(user._id, { role });
  },
});
