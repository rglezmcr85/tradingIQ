import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { confirmRecommendation, readDesk, runDesk } from "../bot/lib/desk";
import { liveGate } from "../bot/lib/live-gate";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "public");
const port = Number(process.env.PORT ?? 4173);
const host = "127.0.0.1";

let deskInFlight: Promise<unknown> | null = null;

async function state() {
  return { desk: await readDesk(), live: liveGate() };
}

function send(res: import("node:http").ServerResponse, status: number, body: string, type: string) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${host}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/state") {
      send(res, 200, JSON.stringify(await state()), "application/json");
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/scan") {
      if (!deskInFlight) {
        deskInFlight = runDesk().finally(() => {
          deskInFlight = null;
        });
      }
      await deskInFlight;
      send(res, 200, JSON.stringify(await state()), "application/json");
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/confirm") {
      const raw = await readBody(req);
      const body = raw ? (JSON.parse(raw) as { id?: string }) : {};
      const id = typeof body.id === "string" ? body.id : "";
      const result = await confirmRecommendation(id);
      send(res, 200, JSON.stringify({ ...(await state()), confirm: result }), "application/json");
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
