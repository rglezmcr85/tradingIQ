import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dataDir, weekPath } from "./paths";
import { emptyBook, saveBook } from "./paper";
import { runScan } from "./pipeline";

/** Daily at 21:30 UTC, after the US cash close. Evaluated in UTC. */
export const WEEK_CRON = "30 21 * * *";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type WeekFile = {
  mode: "paper";
  startedAt: string;
  endsAt: string;
  cron: typeof WEEK_CRON;
  runs: Array<{ slot: string; at: string }>;
};

export type WeekStatus = {
  active: boolean;
  week: WeekFile | null;
  reason: string;
};

export function nextCloseRun(from: Date): Date {
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 21, 30, 0, 0));
  if (next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

async function readWeek(): Promise<WeekFile | null> {
  try {
    const parsed = JSON.parse(await readFile(weekPath, "utf8")) as WeekFile;
    if (parsed.mode !== "paper" || !parsed.endsAt || !Array.isArray(parsed.runs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeWeek(week: WeekFile): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(weekPath, JSON.stringify(week, null, 2));
}

export async function weekStatus(now = Date.now()): Promise<WeekStatus> {
  const week = await readWeek();
  if (!week) {
    return { active: false, week: null, reason: "The one-week paper run has not been started." };
  }
  const active = now < Date.parse(week.endsAt);
  return {
    active,
    week,
    reason: active
      ? "Paper week is active. Live Robinhood orders stay blocked."
      : "The one-week paper run has ended.",
  };
}

/** Start a fresh $50 paper week, or resume one that has not ended. */
export async function startWeek(now = new Date()): Promise<WeekFile> {
  const current = await readWeek();
  if (current && now.getTime() < Date.parse(current.endsAt)) return current;
  const week: WeekFile = {
    mode: "paper",
    startedAt: now.toISOString(),
    endsAt: new Date(now.getTime() + WEEK_MS).toISOString(),
    cron: WEEK_CRON,
    runs: [],
  };
  await saveBook(emptyBook());
  await writeWeek(week);
  return week;
}

/** Run one paper scan for this slot. A repeated slot does not scan again. */
export async function runWeekSlot(slot: string): Promise<{ ran: boolean; reason: string }> {
  const status = await weekStatus();
  if (!status.active || !status.week) return { ran: false, reason: status.reason };
  if (status.week.runs.some((run) => run.slot === slot)) {
    return { ran: false, reason: `Slot ${slot} already ran.` };
  }
  await runScan();
  status.week.runs.push({ slot, at: new Date().toISOString() });
  await writeWeek(status.week);
  return { ran: true, reason: "Paper scan applied. No live order was sent." };
}
