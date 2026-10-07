import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { backtestBars } from './CompiledStrategyBacktester.js';

const RECEIPT_SCHEMA_VERSION = 2;

function runExecutable(command, args = ['--version'], timeoutMs = 30_000) {
    return new Promise(resolve => {
        const startedAt = Date.now();
        const child = spawn(command, args, {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONNOUSERSITE: '1' }
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({
                command, args, durationMs: Date.now() - startedAt,
                stdout: stdout.trim().slice(0, 20_000),
                stderr: stderr.trim().slice(0, 20_000),
                ...result
            });
        };
        const timer = setTimeout(() => {
            child.kill();
            finish({ available: true, passed: false, timedOut: true, code: null, error: 'command_timeout' });
        }, timeoutMs);
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.once('error', error => finish({ available: false, passed: false, code: null, error: error.message }));
        child.once('close', code => finish({ available: true, passed: code === 0, code, timedOut: false }));
    });
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function boundedNumber(value, fallback, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, finiteNumber(value, fallback)));
}

function integerWindow(value, fallback, minimum = 2, maximum = 10_000) {
    return Math.round(boundedNumber(value, fallback, minimum, maximum));
}

function pythonFloat(value, fallback, minimum = -Infinity, maximum = Infinity) {
    return String(boundedNumber(value, fallback, minimum, maximum));
}

function safeArtifactId(candidate = {}) {
    const raw = candidate.id || candidate.strategyId || candidate.compiledStrategy?.id || 'candidate';
    const safe = String(raw).replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
    return safe || `candidate_${sha256(JSON.stringify(candidate)).slice(0, 12)}`;
}

function freqtradeTimeframe(value = '1H') {
    const normalized = String(value || '1H').trim().toUpperCase();
    const match = normalized.match(/^(\d+)(MIN|M|H|D)$/);
    if (!match) return '1h';
    const unit = match[2] === 'MIN' || match[2] === 'M' ? 'm' : match[2].toLowerCase();
    return `${Number(match[1])}${unit}`;
}

function defaultToolPath(tool) {
    const executable = process.platform === 'win32' ? `${tool}.exe` : tool;
    const candidate = process.platform === 'win32'
        ? path.join(process.cwd(), '.soma_trade_venv', 'Scripts', executable)
        : path.join(process.cwd(), '.soma_trade_venv', 'bin', executable);
    return existsSync(candidate) ? candidate : tool;
}

function buildPaperConfig(candidate = {}) {
    const symbol = String(candidate.symbol || candidate.compiledStrategy?.symbol || 'BTC-USD').toUpperCase();
    const pair = symbol.replace(/-USD$/, '/USD');
    return {
        $schema: 'https://schema.freqtrade.io/schema.json',
        dry_run: true,
        dry_run_wallet: 10_000,
        trading_mode: 'spot',
        margin_mode: '',
        stake_currency: 'USD',
        stake_amount: 250,
        max_open_trades: 1,
        timeframe: freqtradeTimeframe(candidate.compiledStrategy?.dsl?.execution?.timeframe),
        exchange: {
            name: 'binanceus', key: '', secret: '',
            pair_whitelist: [pair], pair_blacklist: []
        },
        pairlists: [{ method: 'StaticPairList', allow_inactive: true }],
        entry_pricing: { price_side: 'other', use_order_book: false },
        exit_pricing: { price_side: 'other', use_order_book: false }
    };
}

function canonicalBars(bars = []) {
    const seen = new Map();
    for (const bar of Array.isArray(bars) ? bars : []) {
        const timestamp = Number(bar?.timestamp ?? bar?.time ?? bar?.date);
        const values = [bar?.open, bar?.high, bar?.low, bar?.close, bar?.volume].map(Number);
        if (!Number.isFinite(timestamp) || values.some(value => !Number.isFinite(value))) continue;
        if (values[0] <= 0 || values[1] <= 0 || values[2] <= 0 || values[3] <= 0 || values[4] < 0) continue;
        seen.set(timestamp, [timestamp, ...values]);
    }
    return [...seen.values()].sort((left, right) => left[0] - right[0]);
}

function utcDateStamp(timestamp) {
    const date = new Date(Number(timestamp));
    if (!Number.isFinite(date.getTime())) return null;
    return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}

function parseFreqtradeBacktest(output = '') {
    const line = String(output).split(/\r?\n/)
        .find(row => /^\|\s*SomaCompiledStrategy\s*\|/.test(row));
    if (!line) return null;
    const cells = line.split('|').slice(1, -1).map(value => value.trim());
    const metrics = {
        strategy: cells[0],
        trades: Number(cells[1]),
        averageProfitPct: Number(cells[2]),
        totalProfitUsd: Number(cells[3]),
        totalProfitPct: Number(cells[4])
    };
    return Object.values(metrics).every(value => typeof value === 'string' || Number.isFinite(value)) ? metrics : null;
}

export class FreqtradeResearchSidecar {
    constructor({
        artifactDir = path.join(process.cwd(), 'data', 'trading', 'sidecars', 'freqtrade'),
        freqtradeCommand = defaultToolPath('freqtrade'),
        pythonCommand = defaultToolPath('python'),
        commandRunner = runExecutable
    } = {}) {
        this.artifactDir = artifactDir;
        this.freqtradeCommand = freqtradeCommand;
        this.pythonCommand = pythonCommand;
        this.commandRunner = commandRunner;
    }

    async probe() {
        const result = await this.commandRunner(this.freqtradeCommand, ['--version'], 30_000);
        return {
            ...result,
            available: result.available === true && result.passed === true,
            version: `${result.stdout || ''}\n${result.stderr || ''}`.trim().slice(0, 500)
        };
    }

    async exportCandidate(candidate = {}) {
        const dsl = candidate.compiledStrategy?.dsl || {};
        const entry = dsl.entry || {};
        const exit = dsl.exit || {};
        const mode = String(entry.mode || 'trend');
        const fastWindow = integerWindow(entry.fastWindow, 12);
        const slowWindow = Math.max(fastWindow + 1, integerWindow(entry.slowWindow, 34));
        const rsiPeriod = integerWindow(entry.rsiPeriod, 14);
        const breakoutWindow = integerWindow(entry.breakoutWindow, 24);
        const entryCondition = mode === 'mean_reversion'
            ? `(dataframe['zscore'] <= -${pythonFloat(entry.entryZ, 1.5, 0.01, 20)})`
            : mode === 'rsi_reversion'
                ? `(dataframe['rsi'] <= ${pythonFloat(entry.rsiOversold, 30, 1, 99)})`
                : mode === 'breakout'
                    ? `(dataframe['close'] > dataframe['channel_high'] * (1 + ${pythonFloat(entry.breakoutBufferPct, 0.001, 0, 1)})) & (dataframe['volume_ratio'] >= ${pythonFloat(entry.minVolumeRatio, 1, 0, 100)})`
                    : `(((dataframe['fast'] - dataframe['slow']) / dataframe['slow']) > ${pythonFloat(entry.minMomentum, 0.0025, -1, 1)})`;
        const exitCondition = mode === 'mean_reversion'
            ? `(dataframe['zscore'] >= ${pythonFloat(exit.exitZ, 0, -20, 20)})`
            : mode === 'rsi_reversion'
                ? `(dataframe['rsi'] >= 50)`
                : mode === 'breakout'
                    ? `(dataframe['close'] < dataframe['slow'])`
                    : `(((dataframe['fast'] - dataframe['slow']) / dataframe['slow']) < ${pythonFloat(exit.exitMomentum, -0.0005, -1, 1)})`;
        const timeframe = freqtradeTimeframe(dsl.execution?.timeframe || '1H');
        const startup = Math.max(40, fastWindow, slowWindow, rsiPeriod, breakoutWindow);
        const takeProfitPct = pythonFloat(exit.takeProfitPct, 0.045, 0.001, 0.95);
        const stopLossPct = pythonFloat(Math.abs(finiteNumber(exit.stopLossPct, 0.018)), 0.018, 0.001, 0.95);
        const strategy = `# Generated by SOMA. Research/dry-run only. Never grants live authority.\nimport talib.abstract as ta\nfrom freqtrade.strategy import IStrategy\n\nclass SomaCompiledStrategy(IStrategy):\n    INTERFACE_VERSION = 3\n    timeframe = '${timeframe}'\n    can_short = False\n    minimal_roi = {"0": ${takeProfitPct}}\n    stoploss = -${stopLossPct}\n    process_only_new_candles = True\n    startup_candle_count = ${startup}\n\n    def populate_indicators(self, dataframe, metadata):\n        dataframe['fast'] = ta.SMA(dataframe, timeperiod=${fastWindow})\n        dataframe['slow'] = ta.SMA(dataframe, timeperiod=${slowWindow})\n        dataframe['std'] = dataframe['close'].rolling(${slowWindow}).std(ddof=0)\n        dataframe['zscore'] = (dataframe['close'] - dataframe['slow']) / dataframe['std'].replace(0, float('nan'))\n        dataframe['rsi'] = ta.RSI(dataframe, timeperiod=${rsiPeriod})\n        dataframe['channel_high'] = dataframe['high'].rolling(${breakoutWindow}).max().shift(1)\n        dataframe['volume_ratio'] = dataframe['volume'] / dataframe['volume'].rolling(${breakoutWindow}).mean().shift(1)\n        return dataframe\n\n    def populate_entry_trend(self, dataframe, metadata):\n        dataframe.loc[(${entryCondition}) & (dataframe['volume'] > 0), 'enter_long'] = 1\n        return dataframe\n\n    def populate_exit_trend(self, dataframe, metadata):\n        dataframe.loc[${exitCondition}, 'exit_long'] = 1\n        return dataframe\n`;
        const candidateDir = path.join(this.artifactDir, safeArtifactId(candidate));
        const strategyPath = path.join(candidateDir, 'SomaCompiledStrategy.py');
        const configPath = path.join(candidateDir, 'config.paper.json');
        const manifestPath = path.join(candidateDir, 'candidate.json');
        const config = buildPaperConfig(candidate);
        const strategySha256 = sha256(strategy);
        const configSource = `${JSON.stringify(config, null, 2)}\n`;
        const manifest = {
            schemaVersion: RECEIPT_SCHEMA_VERSION,
            paperOnly: true,
            liveExecutionAllowed: false,
            strategyId: candidate.strategyId || candidate.id || null,
            candidateId: candidate.id || null,
            symbol: candidate.symbol || null,
            timeframe,
            strategySha256,
            configSha256: sha256(configSource),
            generatedAt: new Date().toISOString(),
            sourceCandidate: candidate
        };
        await fs.mkdir(candidateDir, { recursive: true });
        await fs.writeFile(strategyPath, strategy, 'utf8');
        await fs.writeFile(configPath, configSource, 'utf8');
        await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        return {
            candidateDir, strategyPath, configPath, manifestPath,
            strategySha256, configSha256: manifest.configSha256,
            paperOnly: true, liveExecutionAllowed: false
        };
    }

    async exportBars(candidate = {}, bars = [], artifact = null) {
        const target = artifact || await this.exportCandidate(candidate);
        const rows = canonicalBars(bars);
        const timeframe = freqtradeTimeframe(candidate.compiledStrategy?.dsl?.execution?.timeframe || '1H');
        const symbol = String(candidate.symbol || candidate.compiledStrategy?.symbol || 'BTC-USD').toUpperCase();
        const pair = symbol.replace(/-USD$/, '/USD');
        const filenamePair = pair.replace(/[\/ .@$+:]/g, '_');
        const dataDir = path.join(target.candidateDir, 'data', 'binanceus');
        const dataPath = path.join(dataDir, `${filenamePair}-${timeframe}.json`);
        const source = JSON.stringify(rows);
        const timerangeStart = utcDateStamp(rows[0]?.[0]);
        const timerangeEnd = utcDateStamp(Number(rows.at(-1)?.[0] || 0) + 86_400_000);
        await fs.mkdir(dataDir, { recursive: true });
        await fs.writeFile(dataPath, source, 'utf8');
        return {
            dataDir, dataPath, pair, timeframe, bars: rows.length,
            firstTimestamp: rows[0]?.[0] || null,
            lastTimestamp: rows.at(-1)?.[0] || null,
            timerange: timerangeStart && timerangeEnd ? `${timerangeStart}-${timerangeEnd}` : null,
            dataSha256: sha256(source)
        };
    }

    async validateCandidate(candidate = {}, { bars = [] } = {}) {
        const artifact = await this.exportCandidate(candidate);
        const historicalData = await this.exportBars(candidate, bars, artifact);
        const syntax = await this.commandRunner(this.pythonCommand, ['-m', 'py_compile', artifact.strategyPath], 30_000);
        const probe = await this.probe();
        let load = {
            command: this.freqtradeCommand, args: [], available: false, passed: false,
            code: null, error: 'freqtrade_unavailable', stdout: '', stderr: '', durationMs: 0
        };
        if (probe.available) {
            load = await this.commandRunner(this.freqtradeCommand, [
                'list-strategies', '--strategy-path', artifact.candidateDir,
                '--config', artifact.configPath,
                '--user-data-dir', artifact.candidateDir,
                '--no-color', '--one-column'
            ], 60_000);
            load.passed = load.passed === true
                && /SomaCompiledStrategy/.test(`${load.stdout}\n${load.stderr}`)
                && !/LOAD FAILED|FAILED TO LOAD/i.test(`${load.stdout}\n${load.stderr}`);
        }
        const commonArgs = [
            '--config', artifact.configPath,
            '--strategy', 'SomaCompiledStrategy',
            '--strategy-path', artifact.candidateDir,
            '--user-data-dir', artifact.candidateDir,
            '--data-dir', historicalData.dataDir,
            '--data-format-ohlcv', 'json',
            '--timeframe', historicalData.timeframe,
            '--timerange', historicalData.timerange,
            '--fee', '0.0025',
            '--no-color'
        ];
        let backtest = {
            command: this.freqtradeCommand, args: [], available: probe.available,
            passed: false, code: null, error: 'historical_data_unavailable', stdout: '', stderr: '', durationMs: 0
        };
        let lookahead = { ...backtest };
        if (load.passed && historicalData.bars >= 100) {
            backtest = await this.commandRunner(this.freqtradeCommand, [
                'backtesting', ...commonArgs, '--cache', 'none', '--export', 'none'
            ], 180_000);
            backtest.metrics = parseFreqtradeBacktest(`${backtest.stdout || ''}\n${backtest.stderr || ''}`);
            const lookaheadCsv = path.join(artifact.candidateDir, 'lookahead-analysis.csv');
            await fs.rm(lookaheadCsv, { force: true });
            lookahead = await this.commandRunner(this.freqtradeCommand, [
                'lookahead-analysis', ...commonArgs,
                '--minimum-trade-amount', '1', '--targeted-trade-amount', '20',
                '--lookahead-analysis-exportfilename', lookaheadCsv
            ], 180_000);
            if (existsSync(lookaheadCsv)) {
                const csv = await fs.readFile(lookaheadCsv, 'utf8');
                const [headerLine = '', resultLine = ''] = csv.trim().split(/\r?\n/);
                const headers = headerLine.split(',');
                const values = resultLine.split(',');
                const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
                // The CSV is Freqtrade's authoritative analysis artifact. Some
                // releases return a non-zero process code after still writing
                // a complete, valid bias report, so validate the report itself.
                lookahead.passed = row.strategy === 'SomaCompiledStrategy'
                    && String(row.has_bias).toLowerCase() === 'false'
                    && Number(row.total_signals || 0) >= 1;
                lookahead.result = row;
                lookahead.analysisSha256 = sha256(csv);
                lookahead.analysisPath = lookaheadCsv;
            }
        }
        const checks = {
            syntax: syntax.passed === true,
            freqtradeAvailable: probe.available === true,
            strategyLoaded: load.passed === true,
            historicalData: historicalData.bars >= 100,
            independentBacktest: backtest.passed === true,
            independentEconomics: Number(backtest.metrics?.trades || 0) >= 30
                && Number(backtest.metrics?.totalProfitUsd || 0) > 0
                && Number(backtest.metrics?.totalProfitPct || 0) > 0,
            lookaheadBiasFree: lookahead.passed === true,
            paperOnly: artifact.paperOnly === true && artifact.liveExecutionAllowed === false
        };
        const passed = Object.values(checks).every(Boolean);
        const receiptCore = {
            schemaVersion: RECEIPT_SCHEMA_VERSION,
            engine: 'freqtrade', candidateId: candidate.id || null,
            strategyId: candidate.strategyId || null,
            strategySha256: artifact.strategySha256,
            configSha256: artifact.configSha256,
            dataSha256: historicalData.dataSha256,
            historicalBars: historicalData.bars,
            independentMetrics: backtest.metrics,
            lookaheadResult: lookahead.result || null,
            checks,
            commands: {
                syntax: { command: syntax.command, args: syntax.args, code: syntax.code, durationMs: syntax.durationMs },
                probe: { command: probe.command, args: probe.args, code: probe.code, durationMs: probe.durationMs },
                load: { command: load.command, args: load.args, code: load.code, durationMs: load.durationMs },
                backtest: { command: backtest.command, args: backtest.args, code: backtest.code, durationMs: backtest.durationMs },
                lookahead: { command: lookahead.command, args: lookahead.args, code: lookahead.code, durationMs: lookahead.durationMs }
            },
            passed,
            status: passed ? 'validated' : probe.available ? 'rejected' : 'unavailable',
            paperOnly: true,
            liveExecutionAllowed: false
        };
        const receipt = {
            ...receiptCore,
            receiptSha256: sha256(JSON.stringify(receiptCore)),
            artifact,
            historicalData,
            independentMetrics: backtest.metrics,
            diagnostics: {
                syntax: `${syntax.stdout || ''}\n${syntax.stderr || ''}`.trim().slice(0, 4_000),
                probe: probe.version || '',
                load: `${load.stdout || ''}\n${load.stderr || ''}`.trim().slice(0, 8_000),
                backtest: `${backtest.stdout || ''}\n${backtest.stderr || ''}`.trim().slice(0, 12_000),
                lookahead: `${lookahead.stdout || ''}\n${lookahead.stderr || ''}`.trim().slice(0, 12_000)
            }
        };
        const receiptPath = path.join(artifact.candidateDir, 'validation-receipt.json');
        await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
        return { ...receipt, receiptPath };
    }
}

export class VectorbtResearchSidecar {
    async probe() {
        const workspacePython = process.platform === 'win32'
            ? path.join(process.cwd(), '.soma_train_venv', 'Scripts', 'python.exe')
            : path.join(process.cwd(), '.soma_train_venv', 'bin', 'python');
        const python = existsSync(workspacePython) ? workspacePython : defaultToolPath('python');
        const script = "from importlib.util import find_spec; from importlib.metadata import version; s=find_spec('vectorbt'); print(version('vectorbt') if s else 'missing'); raise SystemExit(0 if s else 2)";
        const result = await runExecutable(python, ['-c', script], 10_000);
        return {
            ...result,
            available: result.available === true && result.passed === true,
            mode: 'capability_probe_only_js_deterministic_fallback'
        };
    }

    /** Deterministic JS fallback means research remains usable without Python/vectorbt. */
    search({ bars = [], candidates = [], initialCapital = 10000 } = {}) {
        return candidates.map(candidate => ({ candidate, result: backtestBars({ bars, candidate, initialCapital }) }))
            .sort((left, right) => (right.result.totalPnl - left.result.totalPnl)
                || (right.result.profitFactor - left.result.profitFactor));
    }
}

export function assessNautilusReadiness(evidence = {}) {
    const checks = {
        researchPassed: evidence.passed === true,
        paperOnly: evidence.policy?.paperOnly === true,
        heldOutTrades: Number(evidence.heldOut?.trades || 0) >= 100,
        heldOutProfitFactor: Number(evidence.heldOut?.profitFactor || 0) >= 1.3,
        positiveLowerConfidenceBound: Number(evidence.heldOut?.returnInterval?.lower95 || -Infinity) > 0,
        shadowEvidence: Number(evidence.shadow?.prospectiveClosedTrades || 0) >= 100 && Number(evidence.shadow?.netPnl || 0) > 0
    };
    return {
        ready: Object.values(checks).every(Boolean), checks,
        action: 'readiness_assessment_only', liveExecutionEnabled: false,
        reason: Object.values(checks).every(Boolean) ? 'eligible_for_separate_human_review' : 'edge_not_proven'
    };
}
