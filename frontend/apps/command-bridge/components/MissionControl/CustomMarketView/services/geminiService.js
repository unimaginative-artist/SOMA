/**
 * Market atmosphere analysis — previously called Gemini (cancelled).
 * Now routes through SOMA's QuadBrain (DeepSeek → Ollama fallback).
 *
 * Returns { atmosphere, poeticState, protocolAdaptation, predictions }
 * On failure returns null → CustomMarketView falls back to generateFallbackAnalysis()
 */

export const analyzeMarketAtmosphere = async (data, activeProtocol = 'UNKNOWN') => {
    const bars = (data || []).slice(-30);
    if (!bars.length) return null;

    const latest = bars[bars.length - 1];
    const first = bars[0];
    if (!latest?.close || !first?.close) return null;

    const trend = latest.close > first.close ? 'bullish' : 'bearish';
    const pctChange = ((latest.close - first.close) / first.close * 100).toFixed(2);

    // Recent bar summary for SOMA context (last 10 bars)
    const barSummary = bars.slice(-10).map(b =>
        `${b.time || ''}: C=${parseFloat(b.close).toFixed(2)} V=${Math.round((b.volume || 0) / 1000)}k`
    ).join(' | ');

    try {
        const res = await fetch('/api/soma/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message:
                    `You are Market View, a cyberpunk market analyst for protocol ${activeProtocol}. ` +
                    `Market trend: ${trend} (${pctChange}% over ${bars.length} bars). ` +
                    `Last 10 bars [time: close volume]: ${barSummary}. ` +
                    `Respond ONLY with valid JSON, no markdown, no explanation:\n` +
                    `{"atmosphere":"ELECTRIC|DORMANT|FRACTURED|VOLATILE|CALM","poeticState":"one evocative sentence describing price movement","protocolAdaptation":"MAX 5 WORDS UPPERCASE TACTICAL DIRECTIVE"}`
            })
        });

        if (!res.ok) throw new Error(`${res.status}`);
        const body = await res.json();
        const text = (body.response || body.message || '').trim();

        // Extract JSON — SOMA sometimes wraps in markdown
        const jsonMatch = text.match(/\{[\s\S]*?\}/);
        if (!jsonMatch) throw new Error('No JSON in response');

        const parsed = JSON.parse(jsonMatch[0]);

        // Validate required fields
        const validAtmospheres = ['ELECTRIC', 'DORMANT', 'FRACTURED', 'VOLATILE', 'CALM'];
        if (!validAtmospheres.includes(parsed.atmosphere)) {
            parsed.atmosphere = trend === 'bullish' ? 'ELECTRIC' : 'FRACTURED';
        }

        // Return qualitative fields; CustomMarketView will use its own generateFallbackAnalysis()
        // for the prediction paths (which require canvas-context math best done locally)
        return {
            atmosphere: parsed.atmosphere,
            poeticState: parsed.poeticState || 'Price moves through uncertain terrain.',
            protocolAdaptation: parsed.protocolAdaptation || 'ADAPT TO CURRENT CONDITIONS',
            predictions: null // signal to CustomMarketView to generate paths locally
        };
    } catch (e) {
        console.warn('[MarketAtmosphere] SOMA unavailable, falling back:', e.message);
        return null; // CustomMarketView calls generateFallbackAnalysis() on null
    }
};
