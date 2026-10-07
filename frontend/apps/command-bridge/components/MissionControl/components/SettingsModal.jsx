import React, { useState, useEffect } from 'react';
import { X, Key, Shield, AlertTriangle, CheckCircle, Settings, Lock, RefreshCw, Activity } from 'lucide-react';

/**
 * Settings Modal - Configure Exchange API Keys for Live Trading
 * Allows users to connect real exchange accounts (Binance, Coinbase, etc.)
 */
export const SettingsModal = ({ isOpen, onClose, onSaveKeys }) => {
    const [activeTab, setActiveTab] = useState('alpaca_paper');
    const [keys, setKeys] = useState({
        alpaca_paper: { apiKey: '', secretKey: '' },
        alpaca_live: { apiKey: '', secretKey: '' },
        binance: { apiKey: '', secretKey: '', testnet: true },
        coinbase: { apiKey: '', secretKey: '', sandbox: true },
        kraken: { apiKey: '', secretKey: '' },
        notifications: { discordWebhookUrl: '' }
    });
    const [testStatus, setTestStatus] = useState(null);
    const [isTesting, setIsTesting] = useState(false);
    // Track which exchanges have credentials saved on backend
    const [savedCredentials, setSavedCredentials] = useState({
        alpaca_paper: false,
        alpaca_live: false,
        binance: false,
        coinbase: false,
        kraken: false,
        notifications: false
    });
    // Track edit mode (when user wants to change saved keys)
    const [editMode, setEditMode] = useState({
        alpaca_paper: false,
        alpaca_live: false,
        binance: false,
        coinbase: false,
        kraken: false,
        notifications: false
    });

    // Check backend for persisted credentials on mount
    useEffect(() => {
        // SECURITY: Remove any legacy plaintext keys from localStorage
        localStorage.removeItem('soma_exchange_keys');

        // Check if exchanges have credentials saved securely on backend
        checkBackendCredentials();

        // Check for notification settings
        fetch('/api/notifications/settings')
            .then(res => res.ok && res.json())
            .then(data => {
                if (data.success && data.settings?.discordWebhookUrl) {
                    setKeys(prev => ({...prev, notifications: data.settings}));
                    setSavedCredentials(prev => ({...prev, notifications: true}));
                }
            })
            .catch(() => {});
    }, []);

    const checkBackendCredentials = async () => {
        try {
            // Check all exchanges at once using the unified endpoint
            const response = await fetch('/api/exchange/credentials-status');
            const data = await response.json();
            if (data.success && data.status) {
                setSavedCredentials(data.status);
            }
        } catch (e) {
            console.error('Failed to check backend credentials:', e);
            // Fallback: check Alpaca individually
            try {
                const alpacaRes = await fetch('/api/alpaca/status');
                const alpacaData = await alpacaRes.json();
                if (alpacaData.success && alpacaData.status) {
                    setSavedCredentials(prev => ({
                        ...prev,
                        alpaca_paper: alpacaData.status.hasPaperCredentials || false,
                        alpaca_live: alpacaData.status.hasLiveCredentials || false
                    }));
                }
            } catch (e2) {
                console.error('Fallback check also failed:', e2);
            }
        }
    };

    const handleSave = async () => {
        // Save notification settings
        if (keys.notifications.discordWebhookUrl) {
            await fetch('/api/notifications/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(keys.notifications)
            });
        }
        
        // Keys are saved securely on the backend via testConnection/connect endpoints
        // Do NOT store in localStorage — only pass to parent for in-memory use
        onSaveKeys(keys);
        onClose();
    };

    const testConnection = async (exchange) => {
        setIsTesting(true);
        setTestStatus(null);

        try {
            let endpoint = '/api/exchange/test';
            let body = {
                exchange,
                apiKey: keys[exchange].apiKey,
                secretKey: keys[exchange].secretKey,
                testnet: keys[exchange].testnet,
                sandbox: keys[exchange].sandbox
            };

            // Use specific Alpaca endpoint for Alpaca (it has full API integration)
            if (exchange === 'alpaca_paper' || exchange === 'alpaca_live') {
                endpoint = '/api/alpaca/connect';
                body = {
                    apiKey: keys[exchange].apiKey,
                    secretKey: keys[exchange].secretKey,
                    paperTrading: exchange === 'alpaca_paper',
                    credentialType: exchange, // Tell backend which credential set to save
                    baseUrl: keys[exchange].baseUrl // Optional custom endpoint
                };
            } else if (exchange === 'binance') {
                endpoint = '/api/binance/connect';
                body = {
                    apiKey: keys[exchange].apiKey,
                    secretKey: keys[exchange].secretKey,
                    testnet: keys[exchange].testnet ?? true
                };
            }

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const result = await response.json();

            if (result.success) {
                // Mark as saved and exit edit mode for all exchanges
                setSavedCredentials(prev => ({ ...prev, [exchange]: true }));
                setEditMode(prev => ({ ...prev, [exchange]: false }));

                if ((exchange === 'alpaca_paper' || exchange === 'alpaca_live') && result.account) {
                    const modeLabel = exchange === 'alpaca_paper' ? 'Paper' : 'Live';
                    setTestStatus({
                        type: 'success',
                        message: `Connected to Alpaca ${modeLabel}! Balance: $${result.account.portfolio_value.toLocaleString()}`
                    });
                } else if (exchange === 'binance' && result.account) {
                    const mode = keys[exchange].testnet ? 'Testnet' : 'Live';
                    const balances = result.account.balances || [];
                    const balanceStr = balances.length > 0
                        ? balances.slice(0, 3).map(b => `${b.asset}: ${parseFloat(b.free).toFixed(4)}`).join(', ')
                        : 'No balances';
                    setTestStatus({
                        type: 'success',
                        message: `Connected to Binance ${mode}! ${balanceStr}${balances.length > 3 ? ` +${balances.length - 3} more` : ''}`
                    });
                } else {
                    // Generic success for other exchanges
                    const exchangeNames = {
                        coinbase: 'Coinbase',
                        kraken: 'Kraken'
                    };
                    setTestStatus({
                        type: 'success',
                        message: `${exchangeNames[exchange] || exchange} credentials saved! ${result.message || ''}`
                    });
                }
            } else {
                setTestStatus({ type: 'error', message: `❌ Connection failed: ${result.error}` });
            }
        } catch (error) {
            setTestStatus({ type: 'error', message: `❌ Connection error: ${error.message}` });
        } finally {
            setIsTesting(false);
        }
    };

    const clearCredentials = async (exchange) => {
        try {
            // Use Alpaca-specific endpoint for Alpaca variants, generic endpoint for others
            const isAlpaca = exchange === 'alpaca_paper' || exchange === 'alpaca_live';
            const endpoint = isAlpaca
                ? '/api/alpaca/clear-credentials'
                : '/api/exchange/clear-credentials';

            const body = isAlpaca
                ? { credentialType: exchange }
                : { exchange };

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const result = await response.json();
            if (result.success) {
                setSavedCredentials(prev => ({ ...prev, [exchange]: false }));
                setEditMode(prev => ({ ...prev, [exchange]: true }));

                // Reset keys based on exchange
                const defaultKeys = {
                    alpaca_paper: { apiKey: '', secretKey: '' },
                    alpaca_live: { apiKey: '', secretKey: '' },
                    binance: { apiKey: '', secretKey: '', testnet: true },
        coinbase: { apiKey: '', secretKey: '', sandbox: true },
        kraken: { apiKey: '', secretKey: '' },
        notifications: { discordWebhookUrl: '' }
    };

                setKeys(prev => ({
                    ...prev,
                    [exchange]: defaultKeys[exchange]
                }));
                setTestStatus({ type: 'success', message: '🔓 Credentials cleared. Enter new API keys.' });
            }
        } catch (error) {
            setTestStatus({ type: 'error', message: `❌ Failed to clear credentials: ${error.message}` });
        }
    };

    if (!isOpen) return null;

    const exchanges = [
        { id: 'alpaca_paper', name: 'Alpaca Paper', popular: true, type: 'stocks', isPaper: true },
        { id: 'alpaca_live', name: 'Alpaca Live', popular: true, type: 'stocks', isLive: true },
        { id: 'binance', name: 'Binance', popular: true, type: 'crypto' },
        { id: 'coinbase', name: 'Coinbase Pro', popular: false, type: 'crypto' },
        { id: 'kraken', name: 'Kraken', popular: false, type: 'crypto' },
        { id: 'notifications', name: 'Notifications', popular: false, type: 'system' }
    ];

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
            <div className="bg-[#09090b] border border-white/10 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-white/10 bg-gradient-to-r from-indigo-500/10 to-purple-500/10">
                    <div className="flex items-center space-x-3">
                        <Settings className="w-6 h-6 text-indigo-400" />
                        <div>
                            <h3 className="text-xl font-bold text-white">Exchange Settings</h3>
                            <p className="text-xs text-zinc-500 mt-1">Configure API keys for live trading</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Warning Banner */}
                <div className="bg-rose-500/10 border-b border-rose-500/20 p-4">
                    <div className="flex items-start space-x-3">
                        <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                        <div className="text-xs text-rose-200">
                            <p className="font-bold mb-1">⚠️ Security Warning</p>
                            <p>Never share your API keys. SOMA stores them locally (not on servers). 
                            Use API keys with <strong>trading permissions only</strong> - disable withdrawals for safety.</p>
                        </div>
                    </div>
                </div>

                {/* Exchange Tabs */}
                <div className="flex border-b border-white/5 px-6 pt-4">
                    {exchanges.map(exchange => (
                        <button
                            key={exchange.id}
                            onClick={() => setActiveTab(exchange.id)}
                            className={`px-4 py-2 text-sm font-medium transition-all relative ${
                                activeTab === exchange.id
                                    ? 'text-indigo-400 border-b-2 border-indigo-400'
                                    : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                        >
                            {exchange.name}
                            {/* Green checkmark if credentials saved */}
                            {savedCredentials[exchange.id] && (
                                <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center">
                                    <CheckCircle className="w-3 h-3 text-white" />
                                </span>
                            )}
                            {/* Blue dot for popular (only show if no credentials saved) */}
                            {exchange.popular && !savedCredentials[exchange.id] && (
                                <span className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full" />
                            )}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="p-6 space-y-4 max-h-[400px] overflow-y-auto custom-scrollbar">
                    {exchanges.map(exchange => (
                        activeTab === exchange.id && (
                            <div key={exchange.id} className="space-y-4">
                                {/* NOTIFICATIONS TAB */}
                                {exchange.id === 'notifications' ? (
                                    <div>
                                        <label className="block text-xs font-bold text-zinc-400 mb-2 uppercase tracking-wider">
                                            Discord Webhook URL
                                        </label>
                                        <input
                                            type="text"
                                            value={keys.notifications.discordWebhookUrl}
                                            onChange={(e) => setKeys(prev => ({...prev, notifications: { discordWebhookUrl: e.target.value }}))}
                                            placeholder="Paste your Discord webhook URL here..."
                                            className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-sm text-zinc-200"
                                        />
                                        <p className="text-xs text-zinc-500 mt-2">Get real-time trade alerts in your Discord server.</p>
                                    </div>
                                ) : (
                                <>
                                {/* Saved Credentials Indicator */}
                                {savedCredentials[exchange.id] && !editMode[exchange.id] && (
                                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center space-x-3">
                                                <Lock className="w-5 h-5 text-emerald-400" />
                                                <div>
                                                    <p className="text-sm font-bold text-emerald-300">API Keys Saved</p>
                                                    <p className="text-xs text-emerald-400/70">Your {exchange.name} credentials are securely stored</p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => clearCredentials(exchange.id)}
                                                className="flex items-center space-x-2 px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 rounded-lg text-amber-300 text-xs font-medium transition-all"
                                            >
                                                <RefreshCw className="w-3 h-3" />
                                                <span>Change Keys</span>
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* API Key */}
                                <div className={savedCredentials[exchange.id] && !editMode[exchange.id] ? 'opacity-50 pointer-events-none' : ''}>
                                    <label className="block text-xs font-bold text-zinc-400 mb-2 uppercase tracking-wider">
                                        <Key className="w-3 h-3 inline mr-1" />
                                        API Key
                                        {savedCredentials[exchange.id] && !editMode[exchange.id] && (
                                            <span className="ml-2 text-emerald-400">(Saved)</span>
                                        )}
                                    </label>
                                    <input
                                        type="text"
                                        value={savedCredentials[exchange.id] && !editMode[exchange.id] ? '••••••••••••••••' : keys[exchange.id].apiKey}
                                        onChange={(e) => setKeys(prev => ({
                                            ...prev,
                                            [exchange.id]: { ...prev[exchange.id], apiKey: e.target.value }
                                        }))}
                                        placeholder="Enter your API key..."
                                        disabled={savedCredentials[exchange.id] && !editMode[exchange.id]}
                                        className={`w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-sm placeholder-zinc-600 focus:outline-none focus:border-indigo-500/50 transition-all font-mono ${
                                            savedCredentials[exchange.id] && !editMode[exchange.id]
                                                ? 'text-zinc-500 bg-zinc-900/50 cursor-not-allowed'
                                                : 'text-zinc-200'
                                        }`}
                                    />
                                </div>

                                {/* Secret Key */}
                                <div className={savedCredentials[exchange.id] && !editMode[exchange.id] ? 'opacity-50 pointer-events-none' : ''}>
                                    <label className="block text-xs font-bold text-zinc-400 mb-2 uppercase tracking-wider">
                                        <Shield className="w-3 h-3 inline mr-1" />
                                        Secret Key
                                        {savedCredentials[exchange.id] && !editMode[exchange.id] && (
                                            <span className="ml-2 text-emerald-400">(Saved)</span>
                                        )}
                                    </label>
                                    <input
                                        type="password"
                                        value={savedCredentials[exchange.id] && !editMode[exchange.id] ? '••••••••••••••••' : keys[exchange.id].secretKey}
                                        onChange={(e) => setKeys(prev => ({
                                            ...prev,
                                            [exchange.id]: { ...prev[exchange.id], secretKey: e.target.value }
                                        }))}
                                        placeholder="Enter your secret key..."
                                        disabled={savedCredentials[exchange.id] && !editMode[exchange.id]}
                                        className={`w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-sm placeholder-zinc-600 focus:outline-none focus:border-indigo-500/50 transition-all font-mono ${
                                            savedCredentials[exchange.id] && !editMode[exchange.id]
                                                ? 'text-zinc-500 bg-zinc-900/50 cursor-not-allowed'
                                                : 'text-zinc-200'
                                        }`}
                                    />
                                </div>

                                {/* Custom Endpoint (Advanced) - For Alpaca only */}
                                {(exchange.id === 'alpaca_paper' || exchange.id === 'alpaca_live') && !savedCredentials[exchange.id] && (
                                    <div>
                                        <label className="block text-xs font-bold text-zinc-500 mb-2 uppercase tracking-wider">
                                            <Activity className="w-3 h-3 inline mr-1" />
                                            Endpoint URL (Optional)
                                        </label>
                                        <input
                                            type="text"
                                            value={keys[exchange.id].baseUrl || ''}
                                            onChange={(e) => setKeys(prev => ({
                                                ...prev,
                                                [exchange.id]: { ...prev[exchange.id], baseUrl: e.target.value }
                                            }))}
                                            placeholder={exchange.isPaper ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets"}
                                            className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-sm placeholder-zinc-600 focus:outline-none focus:border-indigo-500/50 transition-all font-mono text-zinc-200"
                                        />
                                        <p className="text-[10px] text-zinc-600 mt-1">Leave empty to use default {exchange.isPaper ? 'Paper' : 'Live'} endpoint.</p>
                                    </div>
                                )}

                                {/* Testnet/Sandbox Toggle (for supported exchanges - NOT Alpaca since we have separate tabs) */}
                                {(exchange.id === 'binance' || exchange.id === 'coinbase') && (
                                    <div className="flex items-center justify-between bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                                        <div>
                                            <p className="text-sm font-medium text-amber-300">Use Testnet/Sandbox</p>
                                            <p className="text-xs text-amber-500/70 mt-0.5">Practice with fake money first</p>
                                        </div>
                                        <button
                                            onClick={() => {
                                                const toggleKey = exchange.id === 'binance' ? 'testnet' : 'sandbox';
                                                setKeys(prev => ({
                                                    ...prev,
                                                    [exchange.id]: {
                                                        ...prev[exchange.id],
                                                        [toggleKey]: !prev[exchange.id][toggleKey]
                                                    }
                                                }));
                                            }}
                                            className={`w-12 h-6 rounded-full transition-all relative ${
                                                keys[exchange.id][exchange.id === 'binance' ? 'testnet' : 'sandbox']
                                                    ? 'bg-amber-500'
                                                    : 'bg-zinc-700'
                                            }`}
                                        >
                                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${
                                                keys[exchange.id][exchange.id === 'binance' ? 'testnet' : 'sandbox']
                                                    ? 'left-7'
                                                    : 'left-1'
                                            }`} />
                                        </button>
                                    </div>
                                )}

                                {/* Paper/Live Mode Indicator for Alpaca */}
                                {exchange.isPaper && (
                                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
                                        <p className="text-sm font-medium text-emerald-300">📝 Paper Trading Mode</p>
                                        <p className="text-xs text-emerald-400/70 mt-0.5">Practice with $100k virtual money - no real funds at risk</p>
                                    </div>
                                )}
                                {exchange.isLive && (
                                    <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3">
                                        <p className="text-sm font-medium text-rose-300">⚠️ Live Trading Mode</p>
                                        <p className="text-xs text-rose-400/70 mt-0.5">Real money will be used - trade responsibly!</p>
                                    </div>
                                )}

                                {/* Test Connection Button - Only show when not saved or in edit mode */}
                                {(!savedCredentials[exchange.id] || editMode[exchange.id]) && (
                                    <button
                                        onClick={() => testConnection(exchange.id)}
                                        disabled={isTesting || !keys[exchange.id].apiKey || !keys[exchange.id].secretKey}
                                        className="w-full px-4 py-2 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 rounded-lg text-indigo-300 text-sm font-bold uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isTesting ? 'Testing & Saving...' : 'Connect & Save Keys'}
                                    </button>
                                )}

                                {/* Test Status */}
                                {testStatus && (
                                    <div className={`p-3 rounded-lg border ${
                                        testStatus.type === 'success'
                                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                            : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                                    }`}>
                                        <p className="text-sm">{testStatus.message}</p>
                                    </div>
                                )}

                                {/* Help Text */}
                                <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-3">
                                    <p className="text-xs text-blue-300 font-bold mb-1">📚 How to get API keys:</p>
                                    {(exchange.id === 'alpaca_paper' || exchange.id === 'alpaca_live') ? (
                                        <ul className="text-xs text-blue-400/70 space-y-1 list-disc list-inside">
                                            <li>Sign up at <a href="https://alpaca.markets" target="_blank" className="underline">alpaca.markets</a></li>
                                            <li>Go to Dashboard → Your API Keys</li>
                                            {exchange.isPaper ? (
                                                <>
                                                    <li>Select <strong>"Paper"</strong> tab to generate Paper keys</li>
                                                    <li>⚡ Paper trading is FREE with $100k virtual balance</li>
                                                </>
                                            ) : (
                                                <>
                                                    <li>Select <strong>"Live"</strong> tab to generate Live keys</li>
                                                    <li>⚠️ Live keys trade with REAL MONEY</li>
                                                </>
                                            )}
                                            <li>Copy both Key ID and Secret Key</li>
                                            <li className="text-amber-400 font-bold">Lost your Secret Key? Click "Regenerate Key" on Alpaca to get a new one.</li>
                                        </ul>
                                    ) : (
                                        <ul className="text-xs text-blue-400/70 space-y-1 list-disc list-inside">
                                            <li>Login to {exchange.name}</li>
                                            <li>Go to Account → API Management</li>
                                            <li>Create new API key with trading permissions only</li>
                                            <li>Disable withdrawal permissions for security</li>
                                        </ul>
                                    )}\
                                </div>
                                </>
                                )}
                            </div>
                        )
                    ))}
                </div>

                {/* Footer */}
                <div className="flex justify-between items-center p-6 border-t border-white/10 bg-black/40">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-white/10 rounded-lg text-zinc-300 text-sm font-medium transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-6 py-2 bg-indigo-500 hover:bg-indigo-600 border border-indigo-400 rounded-lg text-white text-sm font-bold uppercase tracking-wider transition-all flex items-center space-x-2"
                    >
                        <CheckCircle className="w-4 h-4" />
                        <span>Save & Close</span>
                    </button>
                </div>
            </div>
        </div>
    );
};
