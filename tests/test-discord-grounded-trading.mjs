import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DiscordArbiter } from '../arbiters/DiscordArbiter.js';

const require = createRequire(import.meta.url);
const cognitiveThreadState = require('../core/CognitiveThreadState.cjs');

const arbiter = new DiscordArbiter({
    name: 'Discord-Grounded-Trading-Test',
    brain: {
        processQuery: async () => {
            throw new Error('Trade status should not invoke the conversational brain.');
        },
    },
});

assert.equal(arbiter._isTradingStatusQuestion('How r ur trades today?'), true);
assert.equal(arbiter._isTradingStatusQuestion('How is your portfolio doing?'), true);
assert.equal(arbiter._isTradingStatusQuestion('Hello Soma'), false);

const formatted = arbiter._formatTradingStatusReply({
    all: {
        totalTrades: 765,
        wins: 185,
        losses: 580,
        winRate: 24.183,
        totalPnl: -476.602,
        profitFactor: 0.224,
    },
    today: {
        totalTrades: 3,
        wins: 1,
        losses: 2,
        winRate: 33.333,
        totalPnl: -0.81,
    },
    openTrades: [],
    recentTrades: [{ status: 'closed', symbol: 'ETH-USD', side: 'short', pnl: -0.73 }],
    runtime: { mode: 'paper' },
});

assert.match(formatted, /Today I closed 3 paper trades/);
assert.match(formatted, /-\$0\.81 realized PnL/);
assert.match(formatted, /765 closed paper trades/);
assert.match(formatted, /-\$476\.60 net PnL/);
assert.doesNotMatch(formatted, /how can I assist/i);

const replies = [];
const records = [];
arbiter._buildTradingStatusReply = async () => formatted;
arbiter._recordDiscordInteraction = async event => records.push(event);
arbiter._isAdminUser = () => true;

const handled = await arbiter._handleDiscordCommand({
    reply: async text => replies.push(text),
    channelId: 'test-channel',
    author: { username: 'undeca_', id: 'owner' },
    channel: { name: 'dm' },
}, 'Yeah i asked how were your trades doing today?');

assert.equal(handled.handled, true);
assert.deepEqual(replies, [formatted]);
assert.equal(records[0].action, 'grounded_trading_status');

assert.equal(cognitiveThreadState.isUnsupportedCrossDomainTheater(
    'I will conduct a chemistry experiment to see whether reaction kinetics accelerates software debugging.'
), true);
assert.equal(cognitiveThreadState.isUnsupportedCrossDomainTheater(
    'I ran the JavaScript unit tests and two assertions failed in the Discord route.'
), false);

console.log('discord grounded trading regression passed');
