/** SEC fair-access requires a contact email in the User-Agent. Override with SEC_CONTACT_EMAIL. */
const SEC_CONTACT = process.env.SEC_CONTACT_EMAIL ?? "ricardo@example.com";
const APP_UA = `MyTradingIQ/1.0 (personal research; contact: ${SEC_CONTACT})`;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchText(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 25_000,
): Promise<string> {
  let lastError = `request failed for ${url}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": APP_UA,
          accept: "application/json,text/plain,*/*",
          ...headers,
        },
        signal: ctrl.signal,
      });
      const body = await res.text();
      if (res.status === 429 || res.status === 503) {
        lastError = `HTTP ${res.status} from ${url}`;
        await delay(1500);
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${url}`);
      }
      return body;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("HTTP ")) throw err;
      lastError = err instanceof Error ? err.message : lastError;
      await delay(800);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(lastError);
}

export function delayMs(ms: number): Promise<void> {
  return delay(ms);
}
