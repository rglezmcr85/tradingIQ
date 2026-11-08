/**
 * Optional keep/drop after the rule checks.
 * The key is read only from OPENAI_API_KEY. It is never logged, stored, or returned.
 * gpt-6-luna is the non-mini chat model that replaces GPT-4.1. Ranking stays a short JSON step.
 */

export const RANK_MODEL = "gpt-6-luna";
/** At most a few new buys stay. Held sells and adds are not capped. */
export const MODEL_BUY_CAP = 3;

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OFF_NOTE = "OpenAI ranking is off because OPENAI_API_KEY is unset. This scan uses the rules only.";
const UNAVAILABLE_NOTE = "OpenAI ranking did not run. This scan kept the rule results.";

const SYSTEM = [
  "You rank candidates that already passed the trading rules.",
  "Read only the numbers in the payload. Do not invent a price, average, RSI, filing figure, market cap, or quantity.",
  "A null field was not fetched. Do not fill it in.",
  "For action buy, set verdict to keep or drop. Do not add a symbol that is not in the payload.",
  `The desk keeps at most ${MODEL_BUY_CAP} buys marked keep, in the listed order.`,
  "For action sell or add, set verdict to keep. sentence is a short risk note. Do not hide a sell.",
  "sentence is one sentence and cites only numbers present on that candidate.",
  "Copy id exactly.",
].join(" ");

const RANK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: ["keep", "drop"] },
          sentence: { type: "string" },
        },
        required: ["id", "verdict", "sentence"],
      },
    },
  },
  required: ["rows"],
};

export type RankFigures = {
  asOf: string | null;
  trend: string;
  lastClose: number | null;
  sma20: number | null;
  sma50: number | null;
  rsi14: number | null;
  netIncome: number | null;
  revenueGrowth: number | null;
  trailingPe: number | null;
  marketCap: number | null;
  qty: number | null;
  notional: number | null;
};

export type RankRow = {
  id: string;
  symbol: string;
  action: "buy" | "add" | "sell";
  scope: "owned" | "new";
  confirmable: boolean;
  reason: string;
  order: { reason: string } | null;
};

export type Ranked<T extends RankRow> = {
  rows: T[];
  model: "off" | "on" | "unavailable";
  modelNote: string;
};

type Verdict = { verdict: "keep" | "drop"; sentence: string };

/** Blank or missing is off. The value stays in this function and the Authorization header. */
function openAiKey(env: NodeJS.ProcessEnv): string | null {
  const value = env.OPENAI_API_KEY;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function rankingOffNote(env: NodeJS.ProcessEnv): string | null {
  return openAiKey(env) ? null : OFF_NOTE;
}

function oneSentence(text: string): string | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const match = cleaned.match(/^.*?[.!?](?:\s|$)/);
  const sentence = (match ? match[0] : cleaned).trim();
  if (!sentence || sentence.length > 320) return null;
  return sentence;
}

function allowedNumbers(figures: RankFigures): number[] {
  const values: number[] = [];
  const push = (value: number) => {
    if (Number.isFinite(value)) values.push(value);
  };
  for (const value of [
    figures.lastClose,
    figures.sma20,
    figures.sma50,
    figures.rsi14,
    figures.netIncome,
    figures.revenueGrowth,
    figures.trailingPe,
    figures.marketCap,
    figures.qty,
    figures.notional,
  ]) {
    if (value == null) continue;
    push(value);
    push(value * 100);
    push(Math.round(value * 100) / 100);
    push(Math.round(value));
  }
  if (figures.asOf) {
    for (const part of figures.asOf.match(/\d+/g) ?? []) push(Number(part));
  }
  return values;
}

function closeEnough(candidate: number, allowed: number): boolean {
  const diff = Math.abs(candidate - allowed);
  const scale = Math.max(Math.abs(allowed), 1);
  return diff <= 0.06 || diff / scale <= 0.02;
}

/** A cited number has to be one the scan already fetched. Indicator names are not figures. */
function citesOnlyFetched(sentence: string, figures: RankFigures): boolean {
  const stripped = sentence.replace(/SMA\s*20/gi, " ").replace(/SMA\s*50/gi, " ").replace(/RSI\s*14/gi, " ");
  const matches = stripped.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? [];
  if (matches.length === 0) return false;
  const allowed = allowedNumbers(figures);
  return matches.every((raw) => {
    const n = Number(raw.replace(/,/g, ""));
    return Number.isFinite(n) && allowed.some((value) => closeEnough(n, value));
  });
}

function usableSentence(text: string, figures: RankFigures, action: RankRow["action"]): string | null {
  const sentence = oneSentence(text);
  if (!sentence || !citesOnlyFetched(sentence, figures)) return null;
  if (action === "sell" && /\b(hide|skip|ignore|cancel)\b/i.test(sentence)) return null;
  return sentence;
}

function sticky(row: RankRow): boolean {
  return row.scope === "owned" || row.action === "sell" || row.action === "add";
}

function applyVerdicts<T extends RankRow>(
  passed: Array<{ row: T; figures: RankFigures }>,
  byId: Map<string, Verdict>,
): T[] {
  const kept: T[] = [];
  let buys = 0;
  for (const item of passed) {
    const row = item.row;
    const verdict = byId.get(row.id);
    if (!sticky(row)) {
      if (!verdict || verdict.verdict !== "keep") continue;
      if (buys >= MODEL_BUY_CAP) continue;
      buys += 1;
    }
    const sentence = verdict ? usableSentence(verdict.sentence, item.figures, row.action) : null;
    if (sentence) {
      row.reason = `${row.reason} ${sentence}`;
      if (row.order) row.order.reason = row.reason;
    }
    kept.push(row);
  }
  return kept;
}

function readVerdicts(body: unknown): Map<string, Verdict> | null {
  if (!body || typeof body !== "object") return null;
  const rows = (body as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return null;
  const map = new Map<string, Verdict>();
  for (const row of rows) {
    if (!row || typeof row !== "object") return null;
    const id = (row as { id?: unknown }).id;
    const verdict = (row as { verdict?: unknown }).verdict;
    const sentence = (row as { sentence?: unknown }).sentence;
    if (typeof id !== "string" || (verdict !== "keep" && verdict !== "drop")) return null;
    if (typeof sentence !== "string") return null;
    if (!map.has(id)) map.set(id, { verdict, sentence });
  }
  return map;
}

function messageText(content: unknown): string | null {
  if (typeof content === "string" && content.trim()) return content;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((part) => {
      if (!part || typeof part !== "object" || !("text" in part)) return "";
      return typeof part.text === "string" ? part.text : "";
    })
    .join("");
  return text.trim() ? text : null;
}

async function requestRank(
  key: string,
  passed: Array<{ row: RankRow; figures: RankFigures }>,
  fetchImpl: typeof fetch,
): Promise<Map<string, Verdict> | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetchImpl(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: RANK_MODEL,
        reasoning_effort: "none",
        max_completion_tokens: 1200,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "desk_rank",
            strict: true,
            schema: RANK_SCHEMA,
          },
        },
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: JSON.stringify({
              candidates: passed.map((item) => ({
                id: item.row.id,
                symbol: item.row.symbol,
                action: item.row.action,
                figures: item.figures,
              })),
            }),
          },
        ],
      }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) return null;
    const parsed = JSON.parse(text) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = messageText(parsed.choices?.[0]?.message?.content);
    if (!content) return null;
    return readVerdicts(JSON.parse(content));
  } finally {
    clearTimeout(timer);
  }
}

export async function rankPassed<T extends RankRow>(
  passed: Array<{ row: T; figures: RankFigures }>,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Ranked<T>> {
  const rows = passed.map((item) => item.row);
  const key = openAiKey(env);
  if (!key) return { rows, model: "off", modelNote: OFF_NOTE };
  if (passed.length === 0) {
    return {
      rows,
      model: "on",
      modelNote: "OpenAI ranking is on. No passed candidate was sent, so this scan uses the rules only.",
    };
  }
  try {
    const verdicts = await requestRank(key, passed, fetchImpl);
    if (!verdicts) return { rows, model: "unavailable", modelNote: UNAVAILABLE_NOTE };
    const next = applyVerdicts(passed, verdicts);
    const buys = next.filter((row) => row.action === "buy" && row.scope === "new").length;
    return {
      rows: next,
      model: "on",
      modelNote: `OpenAI ranking kept ${buys} new buys (at most ${MODEL_BUY_CAP}). Held sells and adds stay.`,
    };
  } catch {
    return { rows, model: "unavailable", modelNote: UNAVAILABLE_NOTE };
  }
}
