import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root, independent of the agent process cwd. */
export const projectRoot = path.resolve(here, "../..");
export const dataDir = path.join(projectRoot, "data");
export const cacheDir = path.join(dataDir, "cache");
export const paperBookPath = path.join(dataDir, "paper-book.json");
export const lastScanPath = path.join(dataDir, "last-scan.json");
