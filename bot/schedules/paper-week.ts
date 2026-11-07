import { defineSchedule } from "@grok/agent-sdk/schedules";
import { runWeekSlot, WEEK_CRON } from "../lib/week";

/** One paper scan a day for the active $50 week. Does not submit a live order. */
export default defineSchedule({
  cron: WEEK_CRON,
  async run() {
    const slot = new Date().toISOString().slice(0, 10);
    await runWeekSlot(slot);
  },
});
