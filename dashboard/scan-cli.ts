import { runScan } from "../bot/lib/pipeline";
import { RULES } from "../bot/lib/rules";

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : RULES.deepAnalysisDefault;

const report = await runScan(limit);
const actions = report.analyses.map((row) => `${row.symbol}:${row.decision.action}`).join(" ");
console.log(
  JSON.stringify(
    {
      generatedAt: report.generatedAt,
      listedCommonStocks: report.universe.listedCommonStocks,
      screenerRows: report.universe.screenerRows,
      passedScreen: report.universe.passedScreen,
      analyzed: report.universe.analyzed,
      skipped: report.universe.skipped,
      actions,
      equity: report.paper.equity,
      totalPnl: report.paper.totalPnl,
      live: report.live.submission,
    },
    null,
    2,
  ),
);
