import { defineSchedule } from "@grok/agent-sdk/schedules";
import { WEEK_CRON } from "../lib/week";

/** Clock stays registered so an old deploy does not trade. Orders are dashboard confirms only. */
export default defineSchedule({
  cron: WEEK_CRON,
  async run() {
    return;
  },
});
