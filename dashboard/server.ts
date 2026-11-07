import { createServer } from "node:http";
import { handleRequest } from "./handler";

const port = Number(process.env.PORT ?? 4173);
const host = "0.0.0.0";

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  const request = new Request(`http://${host}${req.url ?? "/"}`, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: body.length > 0 ? body : undefined,
  });
  const response = await handleRequest(request);
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(port, host, () => {
  console.log(`MyTradingIQ dashboard http://127.0.0.1:${port}`);
});
