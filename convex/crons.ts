import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("re-queue stuck n8n deliveries", { minutes: 10 }, internal.automation.sweepStuck, {});

export default crons;
