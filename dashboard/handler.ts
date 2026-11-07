import { readFile } from "node:fs/promises";
import path from "node:path";
import { confirmRecommendation, readDesk, runDesk } from "../bot/lib/desk";
import { liveGate } from "../bot/lib/live-gate";
import { projectRoot } from "../bot/lib/paths";

const publicDir = path.join(projectRoot, "public");

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

async function staticFile(pathname: string): Promise<Response | null> {
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.normalize(path.join(publicDir, rel));
  const relative = path.relative(publicDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  try {
    const body = await readFile(filePath);
    const type = filePath.endsWith(".css")
      ? "text/css"
      : filePath.endsWith(".js")
        ? "text/javascript"
        : "text/html; charset=utf-8";
    return new Response(body, {
      status: 200,
      headers: { "content-type": type, "cache-control": "no-store" },
    });
  } catch {
    return null;
  }
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
