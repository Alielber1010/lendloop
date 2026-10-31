import { ConvexError } from "convex/values";
import { CATEGORIES, CONDITIONS } from "../../convex/lib/validators";

export { CATEGORIES, CONDITIONS };
export type Category = (typeof CATEGORIES)[number];
export type Condition = (typeof CONDITIONS)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  power_tools: "Power tools",
  hand_tools: "Hand tools",
  garden: "Garden",
  kitchen: "Kitchen",
  camping: "Camping",
  cleaning: "Cleaning",
  ladders: "Ladders",
  other: "Other",
};

export const CONDITION_LABEL: Record<Condition, string> = {
  like_new: "Like new",
  good: "Good",
  fair: "Fair",
  well_used: "Well used",
};

/** User-facing text for a failed mutation: our ConvexError messages, never stack traces. */
export function errorMessage(e: unknown): string {
  if (e instanceof ConvexError && typeof e.data === "string") return e.data;
  return "Something went wrong. Please try again.";
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.round((ms - now) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of steps) if (Math.abs(s) >= size) return rtf.format(Math.round(s / size), unit);
  return "just now";
}

export function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
