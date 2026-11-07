import { fetchText } from "./http";
import { RULES } from "./rules";

const NASDAQ_LISTED = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt";
const OTHER_LISTED = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt";
const SCREENER =
  "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&offset=0&download=true";

const NAME_EXCLUDE =
  /\b(warrant|warrants|preferred|preference|rights|right|units|unit|debenture|notes|note|acquisition corp|blank check)\b/i;

export type ListedSymbol = {
  symbol: string;
  name: string;
  venue: "nasdaq" | "other-us-exchange";
};

export type ScreenHit = {
  symbol: string;
  name: string;
  lastSale: number;
  volume: number;
  marketCap: number;
  dollarVolume: number;
  sector: string;
  industry: string;
};

export type UniverseScan = {
  listedCommonStocks: number;
  nasdaqListed: number;
  otherListed: number;
  screenerRows: number;
  passedScreen: number;
  ranked: ScreenHit[];
  snapshotFetchedAt: string;
};

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,]/g, "").trim();
  if (cleaned === "" || cleaned === "N/A" || cleaned === "--") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function isCommonName(name: string): boolean {
  return !NAME_EXCLUDE.test(name);
}

function parseDirectory(text: string, venue: ListedSymbol["venue"]): ListedSymbol[] {
  const lines = text.split(/\r?\n/).filter((line) => line.includes("|"));
  const rows = lines.slice(1);
  const listed: ListedSymbol[] = [];
  for (const line of rows) {
    if (line.startsWith("File Creation Time")) continue;
    const cols = line.split("|");
    const symbol = (cols[0] ?? "").trim().toUpperCase();
    const name = (cols[1] ?? "").trim();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) continue;
    const etf = venue === "nasdaq" ? cols[6] : cols[4];
    const test = venue === "nasdaq" ? cols[3] : cols[6];
    if ((etf ?? "").trim().toUpperCase() === "Y") continue;
    if ((test ?? "").trim().toUpperCase() === "Y") continue;
    if (!isCommonName(name)) continue;
    listed.push({ symbol, name, venue });
  }
  return listed;
}

type ScreenerPayload = {
  data?: {
    rows?: Array<{
      symbol?: string;
      name?: string;
      lastsale?: string;
      volume?: string;
      marketCap?: string;
      sector?: string;
      industry?: string;
    }>;
  };
};

export async function scanUniverse(): Promise<UniverseScan> {
  const [nasdaqText, otherText, screenerText] = await Promise.all([
    fetchText(NASDAQ_LISTED),
    fetchText(OTHER_LISTED),
    fetchText(SCREENER, {
      accept: "application/json",
      "user-agent": "Mozilla/5.0",
      origin: "https://www.nasdaq.com",
      referer: "https://www.nasdaq.com/",
    }),
  ]);
  const nasdaq = parseDirectory(nasdaqText, "nasdaq");
  const other = parseDirectory(otherText, "other-us-exchange");
  const bySymbol = new Map<string, ListedSymbol>();
  for (const row of [...nasdaq, ...other]) bySymbol.set(row.symbol, row);

  const payload = JSON.parse(screenerText) as ScreenerPayload;
  const rows = payload.data?.rows ?? [];
  const ranked: ScreenHit[] = [];
  for (const row of rows) {
    const symbol = (row.symbol ?? "").trim().toUpperCase();
    const listed = bySymbol.get(symbol);
    if (!listed) continue;
    if (!isCommonName(row.name || listed.name)) continue;
    const lastSale = parseNumber(row.lastsale);
    const volume = parseNumber(row.volume);
    const marketCap = parseNumber(row.marketCap);
    if (lastSale == null || volume == null || marketCap == null) continue;
    if (lastSale < RULES.minPrice) continue;
    if (volume < RULES.minShareVolume) continue;
    if (marketCap < RULES.minMarketCap) continue;
    ranked.push({
      symbol,
      name: listed.name || row.name || symbol,
      lastSale,
      volume,
      marketCap,
      dollarVolume: lastSale * volume,
      sector: row.sector ?? "",
      industry: row.industry ?? "",
    });
  }
  ranked.sort((a, b) => b.dollarVolume - a.dollarVolume);
  return {
    listedCommonStocks: bySymbol.size,
    nasdaqListed: nasdaq.length,
    otherListed: other.length,
    screenerRows: rows.length,
    passedScreen: ranked.length,
    ranked,
    snapshotFetchedAt: new Date().toISOString(),
  };
}
