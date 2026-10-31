import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { todayUtc } from "./lib/validators";

/**
 * Demo helper: an approved loan that ended `daysAgo` days ago, so the overdue
 * workflow has something to remind about. The app itself can't create past loans.
 * Internal only: `npx convex run seed:overdueLoan '{"lenderClerkId":"user_…","borrowerClerkId":"user_…"}'`
 */
export const overdueLoan = internalMutation({
  args: { lenderClerkId: v.string(), borrowerClerkId: v.string(), daysAgo: v.optional(v.number()) },
  handler: async (ctx, { lenderClerkId, borrowerClerkId, daysAgo = 2 }) => {
    const byClerk = (clerkId: string) =>
      ctx.db
        .query("users")
        .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
        .unique();
    const [lender, borrower] = await Promise.all([byClerk(lenderClerkId), byClerk(borrowerClerkId)]);
    if (!lender || !borrower) throw new Error("Both users must have signed in once");
    const tool = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", lender._id))
      .first();
    if (!tool) throw new Error("The lender has no listings");
    const day = (n: number) => todayUtc(Date.now() - n * 86_400_000);
    return await ctx.db.insert("loans", {
      toolId: tool._id,
      toolName: tool.name,
      lenderId: lender._id,
      borrowerId: borrower._id,
      startDate: day(daysAgo + 3),
      endDate: day(daysAgo),
      status: "approved",
      decidedAt: Date.now(),
    });
  },
});
