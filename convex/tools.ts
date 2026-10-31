import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getViewer, requireViewer } from "./lib/auth";
import { category, condition, cleanText, todayUtc } from "./lib/validators";
import { closeOpenRequests } from "./lib/loanRules";

const toolInput = {
  name: v.string(),
  category,
  condition,
  description: v.string(),
};

function cleanTool(args: { name: string; description: string }) {
  return {
    name: cleanText(args.name, "Name", 60, 2),
    description: cleanText(args.description, "Description", 400, 0),
  };
}

export type Availability =
  | { state: "available" }
  | { state: "on_loan"; until: string; overdue: boolean }
  | { state: "reserved"; from: string };

/** Derived from approved, unreturned loans so it can never drift out of sync. */
export async function availabilityOf(ctx: QueryCtx, toolId: Id<"tools">): Promise<Availability> {
  const approved = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .take(50);
  const today = todayUtc();
  // An overdue loan is the most useful thing to show, then whatever is out right now.
  const started = approved.filter((l) => l.startDate <= today);
  const current = started.find((l) => l.endDate < today) ?? started[0];
  if (current) return { state: "on_loan", until: current.endDate, overdue: current.endDate < today };
  const next = approved.sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  if (next) return { state: "reserved", from: next.startDate };
  return { state: "available" };
}

/** Public, signed-out view: name and category only. No owner, no description, no status. */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db.query("tools").order("desc").take(100);
    return tools.map((t) => ({ _id: t._id, name: t.name, category: t.category }));
  },
});

export const list = query({
  args: { category: v.optional(category) },
  handler: async (ctx, args) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const tools = args.category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", args.category!))
          .order("desc")
          .take(200)
      : await ctx.db.query("tools").order("desc").take(200);
    return Promise.all(tools.map((t) => toToolView(ctx, t, viewer)));
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
      .order("desc")
      .take(50);
    return Promise.all(tools.map((t) => toToolView(ctx, t, viewer)));
  },
});

async function toToolView(ctx: QueryCtx, tool: Doc<"tools">, viewer: Doc<"users">) {
  const owner = await ctx.db.get(tool.ownerId);
  return {
    ...tool,
    owner: { _id: tool.ownerId, name: owner?.name ?? "Neighbour", trusted: owner?.trustedLender ?? false },
    isMine: tool.ownerId === viewer._id,
    availability: await availabilityOf(ctx, tool._id),
  };
}

export const create = mutation({
  args: toolInput,
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const count = (
      await ctx.db
        .query("tools")
        .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
        .take(51)
    ).length;
    if (count >= 50) throw new ConvexError("You can list up to 50 tools");
    return await ctx.db.insert("tools", {
      ...cleanTool(args),
      category: args.category,
      condition: args.condition,
      ownerId: viewer._id,
    });
  },
});

async function ownToolOrThrow(ctx: MutationCtx, toolId: Id<"tools">) {
  const viewer = await requireViewer(ctx);
  const tool = await ctx.db.get(toolId);
  // Same message for "missing" and "not yours" so ids can't be probed.
  if (!tool || tool.ownerId !== viewer._id) throw new ConvexError("Listing not found");
  return { viewer, tool };
}

export const update = mutation({
  args: { toolId: v.id("tools"), ...toolInput },
  handler: async (ctx, { toolId, ...args }) => {
    const { tool } = await ownToolOrThrow(ctx, toolId);
    await ctx.db.patch(tool._id, { ...cleanTool(args), category: args.category, condition: args.condition });
  },
});

export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const { tool } = await ownToolOrThrow(ctx, toolId);
    const outstanding = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "approved"))
      .first();
    if (outstanding) throw new ConvexError("This tool has an approved loan; mark it returned first");
    await closeOpenRequests(ctx, tool._id);
    await ctx.db.delete(tool._id);
  },
});
