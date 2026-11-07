import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root, independent of the agent process cwd. */
export const projectRoot = path.resolve(here, "../..");
/** Vercel functions can write only under /tmp. Local runs keep the repo data directory. */
export const dataDir = process.env.VERCEL
  ? path.join(os.tmpdir(), "mytradingiq")
  : path.join(projectRoot, "data");
export const cacheDir = path.join(dataDir, "cache");
export const paperBookPath = path.join(dataDir, "paper-book.json");
export const lastScanPath = path.join(dataDir, "last-scan.json");
export const weekPath = path.join(dataDir, "week.json");
export const sleevePath = path.join(dataDir, "alpaca-sleeve.json");
export const alpacaWeekPath = path.join(dataDir, "alpaca-week.json");
export const recommendationsPath = path.join(dataDir, "recommendations.json");
