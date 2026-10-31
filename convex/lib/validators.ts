import { v } from "convex/values";
import { ConvexError } from "convex/values";

export const CATEGORIES = [
  "power_tools",
  "hand_tools",
  "garden",
  "kitchen",
  "camping",
  "cleaning",
  "ladders",
  "other",
] as const;
export const CONDITIONS = ["like_new", "good", "fair", "well_used"] as const;

export const category = v.union(...CATEGORIES.map((c) => v.literal(c)));
export const condition = v.union(...CONDITIONS.map((c) => v.literal(c)));

export const loanStatus = v.union(
  v.literal("requested"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
);

export const eventType = v.union(
  v.literal("loan.requested"),
  v.literal("loan.approved"),
  v.literal("loan.declined"),
  v.literal("loan.cancelled"),
  v.literal("loan.returned"),
);

export const MAX_LOAN_DAYS = 30;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in UTC as YYYY-MM-DD. All loan dates are calendar days in UTC. */
export function todayUtc(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function assertDate(value: string, field: string): string {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new ConvexError(`${field} must be a date (YYYY-MM-DD)`);
  }
  return value;
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

/** Trim and bound free text so one listing can't bloat the table or the UI. */
export function cleanText(value: string, field: string, max: number, min = 1): string {
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length < min) throw new ConvexError(`${field} is required`);
  if (text.length > max) throw new ConvexError(`${field} must be at most ${max} characters`);
  return text;
}
