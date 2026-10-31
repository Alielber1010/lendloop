import { mutation, query } from "./_generated/server";
import { getViewer, requireViewer } from "./lib/auth";

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", viewer._id))
      .order("desc")
      .take(20);
    return rows.map((n) => ({ _id: n._id, message: n.message, read: n.read, at: n._creationTime }));
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) => q.eq("userId", viewer._id).eq("read", false))
      .take(100);
    for (const n of unread) await ctx.db.patch(n._id, { read: true });
  },
});
