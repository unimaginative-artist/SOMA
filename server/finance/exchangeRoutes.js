/**
 * Exchange Routes - Unified API Key Management for All Exchanges
 * Handles credential save/load/clear for Binance, Coinbase, Kraken
 * (Alpaca has its own routes but shares the same storage service)
 */

import express from 'express';
import exchangeCredentials from './ExchangeCredentialsService.js';
import alpacaService from './AlpacaService.js';

const router = express.Router();

/**
 * GET /api/exchange/credentials-status
 * Get status of all saved credentials
 */
router.get('/credentials-status', (req, res) => {
    try {
        const status = exchangeCredentials.getAllStatus();
        res.json({
            success: true,
            status
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/exchange/save-credentials
 * Save credentials for any exchange
 */
router.post('/save-credentials', (req, res) => {
    try {
        const { exchange, apiKey, secretKey, testnet, sandbox, paper } = req.body;

        if (!exchange || !apiKey || !secretKey) {
            return res.status(400).json({
                success: false,
                error: 'Exchange, API Key, and Secret Key are required'
            });
        }

        const validExchanges = ['binance', 'coinbase', 'kraken', 'alpaca', 'alpaca_paper', 'alpaca_live'];
        if (!validExchanges.includes(exchange)) {
            return res.status(400).json({
                success: false,
                error: `Invalid exchange. Must be one of: ${validExchanges.join(', ')}`
            });
        }

        const result = exchangeCredentials.saveCredentials(exchange, {
            apiKey,
            secretKey,
            testnet: testnet ?? true,
            sandbox: sandbox ?? true,
            paperTrading: paper ?? true
        });

        if (result) {
            res.json({
                success: true,
                message: `${exchange} credentials saved successfully`
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to save credentials'
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/exchange/clear-credentials
 * Clear credentials for a specific exchange
 */
router.post('/clear-credentials', (req, res) => {
    try {
        const { exchange } = req.body;

        if (!exchange) {
            return res.status(400).json({
                success: false,
                error: 'Exchange name is required'
            });
        }

        const result = exchangeCredentials.clearCredentials(exchange);

        if (result) {
            res.json({
                success: true,
                message: `${exchange} credentials cleared`
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to clear credentials'
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/exchange/has-credentials/:exchange
 * Check if credentials exist for a specific exchange
 */
router.get('/has-credentials/:exchange', (req, res) => {
    try {
        const { exchange } = req.params;
        const hasCredentials = exchangeCredentials.hasCredentials(exchange);

        res.json({
            success: true,
            exchange,
            hasCredentials
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/exchange/test
 * Test connection for any exchange — actually validates credentials against the exchange API
 */
router.post('/test', async (req, res) => {
    try {
        const { exchange, apiKey, secretKey, testnet, sandbox, baseUrl } = req.body;

        if (!exchange || !apiKey || !secretKey) {
            return res.status(400).json({
                success: false,
                error: 'Exchange, API Key, and Secret Key are required'
            });
        }
        const supportedTests = new Set(['alpaca', 'alpaca_paper', 'alpaca_live', 'binance']);
        if (!supportedTests.has(exchange)) {
            return res.status(501).json({
                success: false,
                connected: false,
                credentialsSaved: false,
                error: `Authenticated ${exchange} connection testing is not implemented. Save credentials separately only if you intend to configure that adapter.`
            });
        }

        let connectionResult = null;

        // ── ALPACA: Real connection test via AlpacaService ──
        if (exchange === 'alpaca_paper' || exchange === 'alpaca_live' || exchange === 'alpaca') {
            const isPaper = exchange !== 'alpaca_live';
            try {
                await alpacaService.connect(apiKey, secretKey, isPaper, true, exchange, baseUrl || null);
                connectionResult = {
                    connected: true,
                    accountValue: alpacaService.accountInfo?.portfolio_value || 'N/A',
                    mode: isPaper ? 'Paper' : 'Live',
                    message: `Alpaca ${isPaper ? 'Paper' : 'Live'} connected — Account: $${alpacaService.accountInfo?.portfolio_value || '?'}`
                };
            } catch (alpacaErr) {
                return res.status(400).json({
                    success: false,
                    error: `Alpaca connection failed: ${alpacaErr.message}`,
                    credentialsSaved: false
                });
            }
        }

        // ── BINANCE: Test via public API ping + account info ──
        else if (exchange === 'binance') {
            try {
                // Public API ping (no auth needed) — verifies network connectivity
                const pingRes = await fetch('https://api.binance.com/api/v3/ping', { signal: AbortSignal.timeout(5000) });
                if (!pingRes.ok) throw new Error('Binance API unreachable');

                // Save credentials first
                exchangeCredentials.saveCredentials(exchange, {
                    apiKey, secretKey, testnet: testnet ?? true
                });

                // Test authenticated endpoint (account info)
                const timestamp = Date.now();
                const { createHmac } = await import('crypto');
                const queryString = `timestamp=${timestamp}`;
                const signature = createHmac('sha256', secretKey).update(queryString).digest('hex');
                const baseUrl = testnet ? 'https://testnet.binance.vision' : 'https://api.binance.com';
                const acctRes = await fetch(
                    `${baseUrl}/api/v3/account?${queryString}&signature=${signature}`,
                    { headers: { 'X-MBX-APIKEY': apiKey }, signal: AbortSignal.timeout(10000) }
                );

                if (acctRes.ok) {
                    const acctData = await acctRes.json();
                    connectionResult = {
                        connected: true,
                        mode: testnet ? 'Testnet' : 'Live',
                        message: `Binance ${testnet ? 'Testnet' : 'Live'} connected — ${acctData.balances?.length || 0} assets`
                    };
                } else {
                    const errBody = await acctRes.json().catch(() => ({}));
                    return res.status(400).json({
                        success: false,
                        error: `Binance auth failed: ${errBody.msg || acctRes.statusText}`,
                        credentialsSaved: true // Keys saved even if auth fails (user can fix)
                    });
                }
            } catch (binanceErr) {
                return res.status(400).json({
                    success: false,
                    error: `Binance connection failed: ${binanceErr.message}`,
                    credentialsSaved: false
                });
            }
        }

        res.json({
            success: true,
            message: connectionResult.message,
            credentialsSaved: true,
            connection: connectionResult
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;
