import { nextCloseRun, runWeekSlot, startWeek } from "../bot/lib/week";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const week = await startWeek();
console.log(
  JSON.stringify(
    {
      mode: week.mode,
      startedAt: week.startedAt,
      endsAt: week.endsAt,
      cron: week.cron,
      cadence: "Daily at 21:30 UTC for 7 days, plus an immediate paper scan.",
    },
    null,
    2,
  ),
);

const kickoff = await runWeekSlot("kickoff");
console.log(kickoff);

const endsAt = Date.parse(week.endsAt);
while (Date.now() < endsAt) {
  const next = nextCloseRun(new Date());
  if (next.getTime() >= endsAt) break;
  const wait = next.getTime() - Date.now();
  console.log(`next paper scan ${next.toISOString()} in ${Math.round(wait / 1000)}s`);
  await sleep(wait);
  if (Date.now() >= endsAt) break;
  const slot = next.toISOString().slice(0, 10);
  console.log(await runWeekSlot(slot));
}

console.log("One-week paper run finished. No live order was sent.");
