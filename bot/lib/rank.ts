/**
 * AI read on figures the scan already fetched.
 * The key is read only from OPENAI_API_KEY. It is never logged, stored, or returned.
 * gpt-6-luna is the chat model. reasoning_effort none keeps the call a short JSON step.
 * This is an opinion. It does not add or remove ideas.
 */

export const RANK_MODEL = "gpt-6-luna";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OFF_NOTE = "AI read did not run because OPENAI_API_KEY is unset. The mathematical read is shown.";
const UNAVAILABLE_NOTE = "AI read did not run. The mathematical read is shown.";

const SYSTEM = [
  "You give your own technical and fundamental read for each idea.",
  "Use only the numbers in that idea. Do not invent a price, average, RSI, filing figure, market cap, or quantity.",
  "A null field was not fetched. Do not fill it in.",
  "action is buy, add, sell, or hold. Use add only when held is true. Use buy only when held is false.",
  "You may disagree with a rule-based read. Do not change a quantity.",
  "sentence is one sentence and cites only numbers present on that idea.",
  "Copy id exactly.",
].join(" ");

const READ_SCHEMA = {
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
          action: { type: "string", enum: ["buy", "add", "sell", "hold"] },
          sentence: { type: "string" },
        },
        required: ["id", "action", "sentence"],
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

export type DeskAction = "buy" | "add" | "sell" | "hold";

export type AiOpinion = {
  action: DeskAction;
  sentence: string | null;
};

export type AiReadResult = {
  byId: Map<string, AiOpinion>;
  model: "off" | "on" | "unavailable";
  modelNote: string;
};

type RawOpinion = { action: DeskAction; sentence: string };

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

function usableSentence(text: string, figures: RankFigures): string | null {
  const sentence = oneSentence(text);
  if (!sentence || !citesOnlyFetched(sentence, figures)) return null;
  return sentence;
}

function normalizeAction(action: string, held: boolean): DeskAction | null {
  if (action !== "buy" && action !== "add" && action !== "sell" && action !== "hold") return null;
  if (!held && action === "add") return "buy";
  if (held && action === "buy") return "add";
  return action;
}

function readOpinions(body: unknown): Map<string, RawOpinion> | null {
  if (!body || typeof body !== "object") return null;
  const rows = (body as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return null;
  const map = new Map<string, RawOpinion>();
  for (const row of rows) {
    if (!row || typeof row !== "object") return null;
    const id = (row as { id?: unknown }).id;
    const action = (row as { action?: unknown }).action;
    const sentence = (row as { sentence?: unknown }).sentence;
    if (typeof id !== "string" || typeof action !== "string" || typeof sentence !== "string") return null;
    if (action !== "buy" && action !== "add" && action !== "sell" && action !== "hold") return null;
    if (!map.has(id)) map.set(id, { action, sentence });
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

async function requestReads(
  key: string,
  ideas: Array<{ id: string; symbol: string; held: boolean; figures: RankFigures }>,
  fetchImpl: typeof fetch,
): Promise<Map<string, RawOpinion> | null> {
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
        max_completion_tokens: 1600,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "desk_read",
            strict: true,
            schema: READ_SCHEMA,
          },
        },
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: JSON.stringify({
              ideas: ideas.map((idea) => ({
                id: idea.id,
                symbol: idea.symbol,
                held: idea.held,
                figures: idea.figures,
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
    return readOpinions(JSON.parse(content));
  } finally {
    clearTimeout(timer);
  }
}

export async function readIdeas(
  ideas: Array<{ id: string; symbol: string; held: boolean; figures: RankFigures }>,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<AiReadResult> {
  const key = openAiKey(env);
  if (!key) return { byId: new Map(), model: "off", modelNote: OFF_NOTE };
  if (ideas.length === 0) {
    return {
      byId: new Map(),
      model: "on",
      modelNote: "AI read is on. No idea was sent, so only the mathematical read is shown.",
    };
  }
  try {
    const raw = await requestReads(key, ideas, fetchImpl);
    if (!raw) return { byId: new Map(), model: "unavailable", modelNote: UNAVAILABLE_NOTE };
    const byId = new Map<string, AiOpinion>();
    for (const idea of ideas) {
      const opinion = raw.get(idea.id);
      if (!opinion) continue;
      const action = normalizeAction(opinion.action, idea.held);
      if (!action) continue;
      byId.set(idea.id, { action, sentence: usableSentence(opinion.sentence, idea.figures) });
    }
    return {
      byId,
      model: "on",
      modelNote: "AI read used gpt-6-luna on the fetched figures. It can disagree with the mathematical read.",
    };
  } catch {
    return { byId: new Map(), model: "unavailable", modelNote: UNAVAILABLE_NOTE };
  }
}
