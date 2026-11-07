import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { confirmRecommendation, readDesk, runDesk } from "../bot/lib/desk";
import { liveGate } from "../bot/lib/live-gate";
import { projectRoot } from "../bot/lib/paths";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Local repo, the bundled function, and the Vercel task root. */
const publicDirs = [
  path.join(projectRoot, "public"),
  path.join(here, "..", "public"),
  path.join(process.cwd(), "public"),
];

/** Same document as public/index.html, used when the function bundle has no public directory. */
export const dashboardHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MyTradingIQ</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <header>
      <div class="brand">
        <div class="kicker">Alpaca paper desk</div>
        <h1>MyTradingIQ</h1>
        <p class="lede" id="lede">Scan when you press the button. Ideas stay recommendations until you confirm that one order.</p>
      </div>
      <div class="controls">
        <span class="badge" id="live-badge">Robinhood blocked</span>
        <button id="scan-button" type="button">Scan portfolio</button>
      </div>
    </header>
    <main>
      <section class="stats" id="stats"></section>
      <section class="split">
        <div class="card">
          <h2>Recommendations</h2>
          <div id="scan-table"></div>
        </div>
        <div class="card">
          <h2>Reason</h2>
          <div id="detail">Scan the Alpaca paper portfolio to load recommendations.</div>
        </div>
      </section>
      <section class="card book">
        <h2>Sleeve and portfolio</h2>
        <div id="book"></div>
      </section>
    </main>
    <footer id="footer"></footer>
    <script src="/app.js"></script>
  </body>
</html>
`;

let deskInFlight: Promise<unknown> | null = null;

async function state() {
  return { desk: await readDesk(), live: liveGate() };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".js")) return "text/javascript";
  return "text/html; charset=utf-8";
}

async function readPublic(rel: string): Promise<{ body: Buffer; type: string } | null> {
  if (rel.includes("\0")) return null;
  for (const dir of publicDirs) {
    const filePath = path.normalize(path.join(dir, rel));
    const relative = path.relative(dir, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    try {
      return { body: await readFile(filePath), type: contentType(filePath) };
    } catch {
      // The next root may be the one that exists inside the function bundle.
    }
  }
  return null;
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

/** GET / is the dashboard page, including when public/index.html is not in the function filesystem. */
async function dashboardPage(): Promise<Response> {
  const file = await readPublic("index.html");
  return htmlResponse(file ? file.body.toString("utf8") : dashboardHtml);
}

async function staticFile(pathname: string): Promise<Response | null> {
  const rel = pathname.replace(/^\/+/, "");
  if (rel === "" || rel === "index.html") return dashboardPage();
  const file = await readPublic(rel);
  if (!file) return null;
  return new Response(file.body.toString("utf8"), {
    status: 200,
    headers: { "content-type": file.type, "cache-control": "no-store" },
  });
}

/** Request handler for the dashboard. It does not listen on a port. */
export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (request.method === "GET" && url.pathname === "/api/state") {
      return json(await state());
    }
    if (request.method === "POST" && url.pathname === "/api/scan") {
      if (!deskInFlight) {
        deskInFlight = runDesk().finally(() => {
          deskInFlight = null;
        });
      }
      await deskInFlight;
      return json(await state());
    }
    if (request.method === "POST" && url.pathname === "/api/confirm") {
      const raw = await request.text();
      const body = raw ? (JSON.parse(raw) as { id?: string }) : {};
      const id = typeof body.id === "string" ? body.id : "";
      const result = await confirmRecommendation(id);
      return json({ ...(await state()), confirm: result });
    }
    if (request.method === "GET") {
      const file = await staticFile(url.pathname);
      if (file) return file;
    }
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "request failed";
    return json({ ok: false, error: message }, 500);
  }
}

export default { fetch: handleRequest };
