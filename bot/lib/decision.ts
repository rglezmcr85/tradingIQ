import type { FundamentalReport } from "./fundamentals";
import type { ResearchNote } from "./research";
import { RULES, type Action, type Bias } from "./rules";
import type { TechnicalReport } from "./technicals";

export type RuleResult = {
  id: string;
  pass: boolean;
  detail: string;
};

export type Decision = {
  action: Action;
  bias: Bias;
  why: string[];
  rules: RuleResult[];
};

function num(value: number | null, digits = 2): string {
  if (value == null) return "missing";
  return value.toFixed(digits);
}

/**
 * Trader rules. Buy requires every buy rule. Sell requires any sell rule.
 * Sell wins if both sets match. Otherwise the action is hold.
 */
export function decide(
  technical: TechnicalReport,
  fundamental: FundamentalReport,
  research: ResearchNote,
): Decision {
  const buyRules: RuleResult[] = [
    {
      id: "enough-bars",
      pass: technical.barCount >= RULES.minDailyBars && technical.lastClose != null,
      detail: `Pulled ${technical.barCount} daily closes (need ${RULES.minDailyBars}).`,
    },
    {
      id: "trend-up",
      pass: technical.trend === "up",
      detail: `Trend is ${technical.trend}. Close ${num(technical.lastClose)}, SMA20 ${num(technical.sma20)}, SMA50 ${num(technical.sma50)}.`,
    },
    {
      id: "sma20-rising",
      pass: technical.sma20Rising === true,
      detail: `SMA20 now ${num(technical.sma20)} versus ${num(technical.sma20FiveBarsAgo)} five sessions ago.`,
    },
    {
      id: "rsi-buy-band",
      pass:
        technical.rsi14 != null &&
        technical.rsi14 >= RULES.rsiBuyMin &&
        technical.rsi14 <= RULES.rsiBuyMax,
      detail: `RSI14 is ${num(technical.rsi14, 1)}. Buy band is ${RULES.rsiBuyMin} to ${RULES.rsiBuyMax}.`,
    },
    {
      id: "sec-facts",
      pass: fundamental.status === "ok",
      detail: fundamental.status === "ok"
        ? `SEC company facts loaded for CIK ${fundamental.cik}.`
        : (fundamental.unavailableReason ?? "SEC company facts were not available."),
    },
    {
      id: "profitable",
      pass: fundamental.netIncome != null && fundamental.netIncome > 0,
      detail: `Latest annual net income is ${fundamental.netIncome == null ? "missing" : fundamental.netIncome}.`,
    },
    {
      id: "revenue-growth",
      pass: fundamental.revenueGrowth != null && fundamental.revenueGrowth > 0,
      detail: `Annual revenue growth is ${fundamental.revenueGrowth == null ? "missing" : fundamental.revenueGrowth}.`,
    },
    {
      id: "valuation-cap",
      pass:
        fundamental.dilutedEps != null &&
        fundamental.dilutedEps > 0 &&
        fundamental.trailingPe != null &&
        fundamental.trailingPe > 0 &&
        fundamental.trailingPe <= RULES.maxTrailingPe,
      detail: `Diluted EPS ${fundamental.dilutedEps ?? "missing"}, trailing P/E ${num(fundamental.trailingPe, 1)}. Cap is ${RULES.maxTrailingPe}.`,
    },
  ];
  const sellRules: RuleResult[] = [
    {
      id: "trend-down",
      pass: technical.trend === "down",
      detail: `Trend is ${technical.trend}.`,
    },
    {
      id: "below-sma50",
      pass:
        technical.lastClose != null &&
        technical.sma50 != null &&
        technical.lastClose < technical.sma50,
      detail: `Close ${num(technical.lastClose)} versus SMA50 ${num(technical.sma50)}.`,
    },
    {
      id: "rsi-extended",
      pass: technical.rsi14 != null && technical.rsi14 >= RULES.rsiExtended,
      detail: `RSI14 is ${num(technical.rsi14, 1)}. Extended at ${RULES.rsiExtended}.`,
    },
    {
      id: "unprofitable",
      pass: fundamental.status === "ok" && fundamental.netIncome != null && fundamental.netIncome < 0,
      detail: `Latest annual net income is ${fundamental.netIncome == null ? "missing" : fundamental.netIncome}.`,
    },
  ];
  const buy = buyRules.every((rule) => rule.pass);
  const sell = sellRules.some((rule) => rule.pass);
  const action: Action = sell ? "sell" : buy ? "buy" : "hold";
  const bias: Bias = action === "buy" ? "bullish" : action === "sell" ? "bearish" : research.stance === "mixed" ? "neutral" : research.stance;
  const why: string[] = [];
  if (action === "buy") {
    why.push("Buy. Every buy rule passed, and no sell rule passed.");
  } else if (action === "sell") {
    why.push("Sell. At least one sell rule passed, so this is not a buy.");
    for (const rule of sellRules.filter((item) => item.pass)) why.push(rule.detail);
  } else {
    why.push("Hold. The buy rules are not all true, and no sell rule fired.");
    for (const rule of buyRules.filter((item) => !item.pass)) why.push(rule.detail);
  }
  why.push(`Research stance is ${research.stance}.`);
  return { action, bias, why, rules: [...buyRules, ...sellRules] };
}

/** Technical buy rules only. Fundamentals are checked later by decide(). */
export function technicalBuyReady(technical: TechnicalReport): boolean {
  return (
    technical.barCount >= RULES.minDailyBars &&
    technical.lastClose != null &&
    technical.trend === "up" &&
    technical.sma20Rising === true &&
    technical.rsi14 != null &&
    technical.rsi14 >= RULES.rsiBuyMin &&
    technical.rsi14 <= RULES.rsiBuyMax
  );
}

export type PositionAction = "sell" | "hold" | "add";

/** An open position is sold, held, or added to. Add uses the same buy rules. */
export function managePosition(decision: Decision): { action: PositionAction; why: string[] } {
  if (decision.action === "sell") {
    return {
      action: "sell",
      why: ["Sell the open position. At least one sell rule passed.", ...decision.why.slice(1)],
    };
  }
  if (decision.action === "buy") {
    return {
      action: "add",
      why: [
        "Add. Every buy rule still passes, and no sell rule passed. One more unit is allowed when the sleeve cash covers it.",
        ...decision.why.slice(1),
      ],
    };
  }
  return {
    action: "hold",
    why: [
      "Hold. No sell rule fired, and the buy rules are not all true, so the position stays and nothing is added.",
      ...decision.why.slice(1),
    ],
  };
}

/**
 * Crypto has no SEC filing. Buy and sell use the daily technical rules only.
 * A missing bar stays a hold. No fundamental figure is filled in.
 */
export function decideCrypto(technical: TechnicalReport): Decision {
  const buyRules: RuleResult[] = [
    {
      id: "enough-bars",
      pass: technical.barCount >= RULES.minDailyBars && technical.lastClose != null,
      detail: `Pulled ${technical.barCount} daily closes (need ${RULES.minDailyBars}).`,
    },
    {
      id: "trend-up",
      pass: technical.trend === "up",
      detail: `Trend is ${technical.trend}. Close ${num(technical.lastClose)}, SMA20 ${num(technical.sma20)}, SMA50 ${num(technical.sma50)}.`,
    },
    {
      id: "sma20-rising",
      pass: technical.sma20Rising === true,
      detail: `SMA20 now ${num(technical.sma20)} versus ${num(technical.sma20FiveBarsAgo)} five sessions ago.`,
    },
    {
      id: "rsi-buy-band",
      pass: technical.rsi14 != null && technical.rsi14 >= RULES.rsiBuyMin && technical.rsi14 <= RULES.rsiBuyMax,
      detail: `RSI14 is ${num(technical.rsi14, 1)}. Buy band is ${RULES.rsiBuyMin} to ${RULES.rsiBuyMax}.`,
    },
  ];
  const sellRules: RuleResult[] = [
    {
      id: "trend-down",
      pass: technical.trend === "down",
      detail: `Trend is ${technical.trend}.`,
    },
    {
      id: "below-sma50",
      pass: technical.lastClose != null && technical.sma50 != null && technical.lastClose < technical.sma50,
      detail: `Close ${num(technical.lastClose)} versus SMA50 ${num(technical.sma50)}.`,
    },
    {
      id: "rsi-extended",
      pass: technical.rsi14 != null && technical.rsi14 >= RULES.rsiExtended,
      detail: `RSI14 is ${num(technical.rsi14, 1)}. Extended at ${RULES.rsiExtended}.`,
    },
  ];
  const buy = buyRules.every((rule) => rule.pass);
  const sell = sellRules.some((rule) => rule.pass);
  const action: Action = sell ? "sell" : buy ? "buy" : "hold";
  const bias: Bias = action === "buy" ? "bullish" : action === "sell" ? "bearish" : "neutral";
  const why: string[] = ["Crypto has no SEC company facts. No fundamental figure was filled in."];
  if (action === "buy") why.push("Buy. Every crypto technical buy rule passed, and no sell rule passed.");
  else if (action === "sell") {
    why.push("Sell. At least one crypto sell rule passed.");
    for (const rule of sellRules.filter((item) => item.pass)) why.push(rule.detail);
  } else {
    why.push("Hold. The crypto buy rules are not all true, and no sell rule fired.");
    for (const rule of buyRules.filter((item) => !item.pass)) why.push(rule.detail);
  }
  return { action, bias, why, rules: [...buyRules, ...sellRules] };
}
