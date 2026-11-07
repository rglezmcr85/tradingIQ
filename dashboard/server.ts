import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { liveGate } from "../bot/lib/live-gate";
import { loadBook, markBook } from "../bot/lib/paper";
import { readLastScan, runScan } from "../bot/lib/pipeline";
import { weekStatus } from "../bot/lib/week";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "public");
const port = Number(process.env.PORT ?? 4173);
const host = "127.0.0.1";

let scanInFlight: Promise<unknown> | null = null;

async function state() {
  const scan = await readLastScan();
  const paper = scan?.paper ?? markBook(await loadBook());
  return { scan, paper, live: liveGate(), week: await weekStatus() };
}

function send(res: import("node:http").ServerResponse, status: number, body: string, type: string) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${host}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/state") {
      send(res, 200, JSON.stringify(await state()), "application/json");
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/scan") {
      if (!scanInFlight) {
        const limit = Number(url.searchParams.get("limit") ?? "8");
        scanInFlight = runScan(limit).finally(() => {
          scanInFlight = null;
        });
      }
      await scanInFlight;
      send(res, 200, JSON.stringify(await state()), "application/json");
      return;
    }
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const filePath = path.normalize(path.join(publicDir, rel));
    if (!filePath.startsWith(publicDir)) {
      send(res, 404, "Not found", "text/plain");
      return;
    }
    await stat(filePath);
    const type = filePath.endsWith(".css")
      ? "text/css"
      : filePath.endsWith(".js")
        ? "text/javascript"
        : "text/html; charset=utf-8";
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    createReadStream(filePath).pipe(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "request failed";
    send(res, 500, JSON.stringify({ ok: false, error: message }), "application/json");
  }
});

server.listen(port, host, () => {
  console.log(`MyTradingIQ dashboard http://${host}:${port}`);
});
