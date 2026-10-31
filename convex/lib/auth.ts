import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Every permission decision in LendLoop goes through these helpers.
 * The UI hides buttons, but these checks are what actually enforce access.
 */

async function identityOrThrow(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in to continue");
  return identity;
}

/** The signed-in user's row, or null (signed out, or first visit before `ensure`). */
export async function getViewer(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique();
}

export async function requireViewer(ctx: QueryCtx): Promise<Doc<"users">> {
  await identityOrThrow(ctx);
  const viewer = await getViewer(ctx);
  if (!viewer) throw new ConvexError("Account not set up yet, reload the page");
  return viewer;
}

export async function requireAdmin(ctx: QueryCtx): Promise<Doc<"users">> {
  const viewer = await requireViewer(ctx);
  if (viewer.role !== "admin") throw new ConvexError("Admins only");
  return viewer;
}

/** Display name from the Clerk token: first name plus last initial, never the email. */
export function displayNameFrom(identity: {
  givenName?: string;
  familyName?: string;
  name?: string;
  nickname?: string;
}): string {
  const first = identity.givenName?.trim() || identity.name?.trim().split(" ")[0] || identity.nickname?.trim();
  if (!first) return "Neighbour";
  const initial = identity.familyName?.trim().charAt(0);
  return (initial ? `${first} ${initial}.` : first).slice(0, 40);
}

export async function upsertViewer(ctx: MutationCtx): Promise<Doc<"users">> {
  const identity = await identityOrThrow(ctx);
  const existing = await getViewer(ctx);
  const name = displayNameFrom(identity);
  if (existing) {
    if (existing.name !== name) await ctx.db.patch(existing._id, { name });
    return { ...existing, name };
  }
  // Bootstrap admins by Clerk user id (not email: ids can't be claimed by someone else).
  const admins = (process.env.LENDLOOP_ADMIN_IDS ?? "").split(",").map((s) => s.trim());
  const id = await ctx.db.insert("users", {
    clerkId: identity.subject,
    name,
    role: admins.includes(identity.subject) ? "admin" : "user",
    trustedLender: false,
  });
  return (await ctx.db.get(id))!;
}
