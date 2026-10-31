import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { category, condition, loanStatus, eventType } from "./lib/validators";

export default defineSchema({
  // One row per Clerk user. Role lives here (not in Clerk metadata) so every
  // permission check happens inside Convex against data Convex owns.
  users: defineTable({
    clerkId: v.string(),
    name: v.string(),
    role: v.union(v.literal("admin"), v.literal("user")),
    trustedLender: v.boolean(),
  }).index("by_clerkId", ["clerkId"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category,
    condition,
    description: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  loans: defineTable({
    toolId: v.id("tools"),
    // Snapshot so loan history survives the listing being removed.
    toolName: v.string(),
    lenderId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD
    endDate: v.string(), // YYYY-MM-DD, inclusive
    message: v.optional(v.string()),
    status: loanStatus,
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
  })
    .index("by_tool_status", ["toolId", "status"])
    .index("by_borrower", ["borrowerId"])
    .index("by_lender", ["lenderId"])
    .index("by_status_endDate", ["status", "endDate"]),

  // Outbox for Convex -> n8n webhooks. Each row is delivered at least once;
  // eventId lets n8n and the write-back endpoint de-duplicate retries.
  automationEvents: defineTable({
    eventId: v.string(),
    type: eventType,
    loanId: v.id("loans"),
    recipientId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("delivered"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    attempts: v.number(),
    nextAttemptAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
  })
    .index("by_eventId", ["eventId"])
    .index("by_status_next", ["status", "nextAttemptAt"]),

  // What automation did for a loan ("Reminder sent 2 days ago").
  // `key` is the idempotency key supplied by the write-back.
  loanActivity: defineTable({
    loanId: v.id("loans"),
    kind: v.union(
      v.literal("notification"),
      v.literal("reminder"),
      v.literal("reminder_failed"),
      v.literal("delivery_failed"),
    ),
    summary: v.string(),
    key: v.string(),
  })
    .index("by_key", ["key"])
    .index("by_loan", ["loanId"]),

  // In-app inbox: the "mock" notification channel n8n delivers to.
  notifications: defineTable({
    userId: v.id("users"),
    loanId: v.id("loans"),
    message: v.string(),
    key: v.string(),
    read: v.boolean(),
  })
    .index("by_key", ["key"])
    .index("by_user", ["userId"])
    .index("by_user_read", ["userId", "read"]),

  // Failed n8n executions reported by the error workflow (admin view).
  automationErrors: defineTable({
    executionId: v.string(),
    workflow: v.string(),
    node: v.string(),
    message: v.string(),
  }).index("by_executionId", ["executionId"]),
});
