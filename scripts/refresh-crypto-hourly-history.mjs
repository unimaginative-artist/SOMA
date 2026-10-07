import { TradingHistoricalDataPipeline } from '../server/finance/TradingHistoricalDataPipeline.js';

const report = await new TradingHistoricalDataPipeline().refreshCoreMarkets();
console.log(JSON.stringify(report, null, 2));
if (!report.success) process.exitCode = 1;
