import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { SimToLiveReconciler } from '../core/signals/generator/SimToLiveReconciler.js';

function marketEntry({ id, symbol, strategyId, prometheusScore = 0.82 }) {
    return {
        id,
        source: 'market-simulation-lab',
        paperOnly: true,
        asset: {
            symbol,
            assetClass: symbol.includes('USD') ? 'crypto' : 'equity',
            allowShort: false
        },
        strategy: {
            id: strategyId,
            name: strategyId
        },
        paperAccount: {
            averageDollarPnl: 12.5
        },
        metrics: {
            trades: 220,
            winRate: 0.66,
            profitFactor: 1.9,
            maxDrawdown: 0.07,
            averageDollarPnl: 12.5,
            prometheusScore
        },
        prometheusScore
    };
}

function closedTrades({ symbol, strategy, wins, losses, winPnl = 1, lossPnl = -0.5 }) {
    const rows = [];
    for (let i = 0; i < wins; i++) {
        rows.push({ id: rows.length + 1, symbol, strategy, status: 'closed', pnl: winPnl, exit_time: `2026-06-25T00:${String(i % 60).padStart(2, '0')}:00.000Z` });
    }
    for (let i = 0; i < losses; i++) {
        rows.push({ id: rows.length + 1, symbol, strategy, status: 'closed', pnl: lossPnl, exit_time: `2026-06-25T01:${String(i % 60).padStart(2, '0')}:00.000Z` });
    }
    return rows;
}

async function withReconciler({ entries, closedTrades: trades }) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-sim-live-'));
    const marketLedgerPath = path.join(dir, 'strategy-ledger.json');
    const reportPath = path.join(dir, 'sim-to-live-report.json');
    await fs.writeFile(marketLedgerPath, JSON.stringify(entries, null, 2), 'utf8');
    const reconciler = new SimToLiveReconciler({
        marketLedgerPath,
        reportPath,
        closedTrades: trades,
        baseCapital: 10000
    });
    return reconciler.runReconciliation();
}

test('sim winners without exact paper evidence are queued for paper testing only', async () => {
    const report = await withReconciler({
        entries: [marketEntry({ id: 'sim-only', symbol: 'GLD', strategyId: 'alpha_sim_candidate' })],
        closedTrades: []
    });

    assert.equal(report.summary.paperQueue, 1);
    assert.equal(report.summary.paperIncumbents, 0);
    assert.equal(report.summary.liveCandidates, 0);
    assert.equal(report.paperQueue[0].state, 'paper_candidate');
    assert.equal(report.paperQueue[0].neededTrades, 100);
});

test('exact paper evidence promotes a sim winner to paper incumbent and human-gated live candidate', async () => {
    const strategyId = 'alpha_paper_pass';
    const symbol = 'TLT';
    const report = await withReconciler({
        entries: [marketEntry({ id: 'paper-pass', symbol, strategyId })],
        closedTrades: closedTrades({ symbol, strategy: strategyId, wins: 80, losses: 40 })
    });

    assert.equal(report.summary.paperIncumbents, 1);
    assert.equal(report.summary.liveCandidates, 1);
    assert.equal(report.selectedIncumbent.strategyId, strategyId);
    assert.equal(report.selectedIncumbent.symbol, symbol);
    assert.equal(report.selectedIncumbent.live.requiresHumanApproval, true);
});

test('paper evidence can quarantine a strong-looking simulation', async () => {
    const strategyId = 'alpha_paper_fail';
    const symbol = 'ETH-USD';
    const report = await withReconciler({
        entries: [marketEntry({ id: 'paper-fail', symbol, strategyId })],
        closedTrades: closedTrades({ symbol, strategy: strategyId, wins: 25, losses: 95 })
    });

    assert.equal(report.summary.quarantined, 1);
    assert.equal(report.quarantined[0].state, 'paper_contradicts_sim');
    assert.ok(report.quarantined[0].reasons.some(reason => reason.includes('paper win rate')));
    assert.equal(report.summary.liveCandidates, 0);
});
