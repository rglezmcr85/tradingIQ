import type { FundamentalReport } from "./fundamentals";
import { RULES } from "./rules";
import type { TechnicalReport } from "./technicals";

export type ResearchNote = {
  bullCase: string[];
  bearCase: string[];
  stance: "bullish" | "bearish" | "mixed";
};

function money(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Bull and bear notes use only the two analyst reports. They do not add figures. */
export function writeResearch(technical: TechnicalReport, fundamental: FundamentalReport): ResearchNote {
  const bullCase: string[] = [];
  const bearCase: string[] = [];
  if (technical.trend === "up") bullCase.push("The daily trend is up.");
  if (technical.trend === "down") bearCase.push("The daily trend is down.");
  if (technical.lastClose != null && technical.sma50 != null && technical.lastClose > technical.sma50) {
    bullCase.push("The last close is above the 50-day average.");
  }
  if (technical.lastClose != null && technical.sma50 != null && technical.lastClose < technical.sma50) {
    bearCase.push("The last close is below the 50-day average.");
  }
  if (technical.sma20Rising === true) bullCase.push("The 20-day average is rising.");
  if (technical.sma20Rising === false) bearCase.push("The 20-day average is falling.");
  if (technical.rsi14 != null && technical.rsi14 >= RULES.rsiBuyMin && technical.rsi14 <= RULES.rsiBuyMax) {
    bullCase.push(`RSI ${technical.rsi14.toFixed(1)} sits inside the buy band.`);
  }
  if (technical.rsi14 != null && technical.rsi14 >= 70) {
    bearCase.push(`RSI ${technical.rsi14.toFixed(1)} is elevated.`);
  }
  if (technical.rsi14 != null && technical.rsi14 < 35) {
    bearCase.push(`RSI ${technical.rsi14.toFixed(1)} is weak.`);
  }
  if (fundamental.status !== "ok") {
    bearCase.push(fundamental.unavailableReason ?? "Fundamentals were not available from SEC company facts.");
  } else {
    if (fundamental.netIncome != null && fundamental.netIncome > 0) {
      bullCase.push(`Latest annual net income is positive (${money(fundamental.netIncome)}).`);
    }
    if (fundamental.netIncome != null && fundamental.netIncome < 0) {
      bearCase.push(`Latest annual net income is negative (${money(fundamental.netIncome)}).`);
    }
    if (fundamental.revenueGrowth != null && fundamental.revenueGrowth > 0) {
      bullCase.push(`Annual revenue grew ${pct(fundamental.revenueGrowth)}.`);
    }
    if (fundamental.revenueGrowth != null && fundamental.revenueGrowth < 0) {
      bearCase.push(`Annual revenue declined ${pct(fundamental.revenueGrowth)}.`);
    }
    if (fundamental.trailingPe != null && fundamental.trailingPe <= RULES.maxTrailingPe) {
      bullCase.push(`Trailing P/E ${fundamental.trailingPe.toFixed(1)} is within the ${RULES.maxTrailingPe} cap.`);
    }
    if (fundamental.trailingPe != null && fundamental.trailingPe > RULES.maxTrailingPe) {
      bearCase.push(`Trailing P/E ${fundamental.trailingPe.toFixed(1)} is above the ${RULES.maxTrailingPe} cap.`);
    }
    if (fundamental.dilutedEps != null && fundamental.dilutedEps <= 0) {
      bearCase.push("Diluted EPS is not positive, so there is no usable trailing P/E.");
    }
  }
  let stance: ResearchNote["stance"] = "mixed";
  if (technical.trend === "down" || (fundamental.netIncome != null && fundamental.netIncome < 0) || bearCase.length > bullCase.length) {
    stance = "bearish";
  } else if (bullCase.length > bearCase.length && fundamental.status === "ok") {
    stance = "bullish";
  }
  return { bullCase, bearCase, stance };
}
